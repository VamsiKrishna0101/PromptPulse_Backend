import prisma from "../../lib/prisma"
import { Prisma } from '@prisma/client'
import { analyzeResponse } from "../llm/gemini_service"
import type { RunPromptInput, DashboardDataInput } from "./dashboard_types"
import { enqueueSourceEnrichment } from "../../queues/source_enrichment_queue"
import { ingestChatById } from "../rag/ingestion_service"
import { normalizeAnswerBlocks } from "./answer_block_normalizer"

export interface DashboardFilters {
    days?: number
    model?: string
    topic?: string
    tag?: string
    prompt_id?: string
    q?: string
}

export function buildChatWhere(project_id: string, filters: DashboardFilters): Prisma.ChatWhereInput {
    const where: Prisma.ChatWhereInput = {
        prompt: { project_id }
    }
    
    if (filters.days) {
        where.created_at = { gte: new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000) }
    }
    
    if (filters.model && filters.model !== 'all') {
        // Handle variations (e.g. ChatGPT could be chatgpt, openai, etc. The DB stores what we save. Typically ChatGPT, Gemini, Perplexity)
        where.ai_model = { contains: filters.model, mode: 'insensitive' }
    }
    
    const promptWhere: Prisma.PromptWhereInput = { project_id }
    let hasPromptFilter = false
    
    if (filters.topic && filters.topic !== 'all') {
        promptWhere.topic = filters.topic
        hasPromptFilter = true
    }
    
    if (filters.tag && filters.tag !== 'all') {
        promptWhere.tags = { has: filters.tag }
        hasPromptFilter = true
    }
    
    if (filters.prompt_id) {
        promptWhere.id = filters.prompt_id
        hasPromptFilter = true
    }
    
    if (hasPromptFilter) {
        where.prompt = promptWhere
    }

    const q = filters.q?.trim()
    if (q) {
        where.OR = [
            { raw_response: { contains: q, mode: 'insensitive' } },
            { prompt: { text: { contains: q, mode: 'insensitive' } } },
            { brand_mentions: { some: { brand_name: { contains: q, mode: 'insensitive' } } } },
            { sources: { some: { domain: { contains: q, mode: 'insensitive' } } } },
            { sources: { some: { title: { contains: q, mode: 'insensitive' } } } }
        ]
    }
    
    return where
}

function previousPeriodFilters(filters: DashboardFilters): DashboardFilters | null {
    if (!filters.days) return null

    return {
        ...filters,
        days: undefined
    }
}

function previousPeriodDateWhere(filters: DashboardFilters) {
    if (!filters.days) return undefined

    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    return {
        gte: new Date(now - filters.days * 2 * dayMs),
        lt: new Date(now - filters.days * dayMs)
    }
}

function deltaValue(current: number | null, previous: number | null, lowerIsBetter = false) {
    if (current === null || previous === null) return null
    const diff = current - previous
    return lowerIsBetter ? -diff : diff
}

function splitAllTimeChats<T extends { created_at: Date }>(chats: T[]) {
    const sorted = [...chats].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    const midpoint = Math.floor(sorted.length / 2)
    return {
        previous: sorted.slice(0, midpoint),
        current: sorted.slice(midpoint)
    }
}

function aggregateOwnBrand(chats: Array<{ brand_mentioned: boolean; brand_position: number | null; sentiment_score: number | null }>) {
    const totalChats = chats.length
    if (totalChats === 0) {
        return { visibility: null, avg_position: null, avg_sentiment: null }
    }

    const brandMentions = chats.filter(c => c.brand_mentioned)
    const positionChats = brandMentions.filter(c => c.brand_position !== null)
    const sentimentChats = brandMentions.filter(c => c.sentiment_score !== null)

    return {
        visibility: (brandMentions.length / totalChats) * 100,
        avg_position: positionChats.length > 0 ? positionChats.reduce((acc, c) => acc + (c.brand_position ?? 0), 0) / positionChats.length : null,
        avg_sentiment: sentimentChats.length > 0 ? sentimentChats.reduce((acc, c) => acc + (c.sentiment_score ?? 0), 0) / sentimentChats.length : null
    }
}

export async function getFilterOptions(project_id: string) {
    const prompts = await prisma.prompt.findMany({
        where: { project_id },
        select: { topic: true }
    })
    
    const topics = Array.from(new Set(prompts.map(p => p.topic).filter(Boolean)))
    
    return { topics, tags: [] }
}

export async function runPrompt(input: RunPromptInput) {
    const { 
        prompt_id, run_id, raw_response, ai_model, screenshot_path, citations,
        geo_variant_id, geo_country_code, geo_country_name, geo_city
    } = input

    const prompt = await prisma.prompt.findUniqueOrThrow({
        where: { id: prompt_id },
        include: { project: true }
    })

    const analysis = await analyzeResponse(
        raw_response,
        ai_model,
        prompt.project.brand_name,
        prompt.project.brand_url,
        citations ?? []
    )

    const chat = await prisma.chat.create({
        data: {
            run_id,
            prompt_id,
            geo_variant_id: geo_variant_id ?? null,
            geo_country_code: geo_country_code ?? null,
            geo_country_name: geo_country_name ?? null,
            geo_city: geo_city ?? null,
            ai_model,
            raw_response,
            answer_blocks: normalizeAnswerBlocks(
                raw_response,
                analysis.brand_mentions.map(mention => mention.brand_name)
            ),
            screenshot_path: screenshot_path ?? null,
            brand_mentioned: analysis.brand_mentioned,
            brand_position: analysis.brand_position ?? null,
            sentiment_score: analysis.sentiment_score ?? null,
            brand_mentions: {
                create: analysis.brand_mentions.map(m => ({
                    brand_name: m.brand_name,
                    position: m.position ?? null,
                    sentiment_score: m.sentiment_score ?? null
                }))
            },
            sources: {
                create: analysis.sources.map(s => ({
                    url: s.url,
                    domain: s.domain,
                    source_type: s.source_type,
                    is_cited: s.is_cited
                }))
            }
        },
        include: {
            brand_mentions: true,
            sources: true
        }
    })

    if (citations?.length) {
        const existingUrls = new Set(chat.sources.map(source => source.url))
        const citationSources = citations
            .filter(citation => citation.url && !existingUrls.has(citation.url))
            .map(citation => ({
                chat_id: chat.id,
                url: citation.url,
                domain: safeDomain(citation.url),
                source_type: "OTHER" as const,
                is_cited: true
            }))

        if (citationSources.length) {
            await prisma.source.createMany({ data: citationSources })
        }
    }

    const sources = await prisma.source.findMany({
        where: { chat_id: chat.id },
        select: { id: true }
    })

    await Promise.all(sources.map((source, index) => enqueueSourceEnrichment(source.id, index * 1000)))
    void ingestChatById(chat.id).catch(error => {
        console.warn("Sara chat ingestion failed", { chat_id: chat.id, error })
    })

    return chat
}

function safeDomain(url: string) {
    try {
        return new URL(url).hostname.replace(/^www\./, "")
    } catch {
        return url
    }
}

export async function getDashboardData({ project_id, filters }: { project_id: string, filters?: DashboardFilters }) {
    const chatWhere = buildChatWhere(project_id, filters || {})

    const chats = await prisma.chat.findMany({
        where: chatWhere,
        include: {
            brand_mentions: true,
            sources: true
        }
    })

    const totalChats = chats.length
    if (totalChats === 0) return null

    const brandStats = aggregateOwnBrand(chats)
    let previousBrandStats: ReturnType<typeof aggregateOwnBrand> | null = null

    if (filters?.days) {
        const previousFilters = previousPeriodFilters(filters) ?? {}
        const previousWhere = buildChatWhere(project_id, previousFilters)
        previousWhere.created_at = previousPeriodDateWhere(filters)
        const previousChats = await prisma.chat.findMany({ where: previousWhere })
        previousBrandStats = aggregateOwnBrand(previousChats)
    } else {
        const split = splitAllTimeChats(chats)
        previousBrandStats = aggregateOwnBrand(split.previous)
        const recentStats = aggregateOwnBrand(split.current)
        brandStats.visibility = brandStats.visibility ?? recentStats.visibility
    }

    const competitorMap = new Map<string, { count: number, totalPosition: number, totalSentiment: number }>()

    for (const chat of chats) {
        for (const mention of chat.brand_mentions) {
            const existing = competitorMap.get(mention.brand_name) || { count: 0, totalPosition: 0, totalSentiment: 0 }
            competitorMap.set(mention.brand_name, {
                count: existing.count + 1,
                totalPosition: existing.totalPosition + (mention.position || 0),
                totalSentiment: existing.totalSentiment + (mention.sentiment_score || 0)
            })
        }
    }

    const competitors = Array.from(competitorMap.entries()).map(([name, data]) => ({
        brand_name: name,
        visibility: (data.count / totalChats) * 100,
        avg_position: data.totalPosition / data.count,
        avg_sentiment: data.totalSentiment / data.count
    })).sort((a, b) => b.visibility - a.visibility)

    const sourceMap = new Map<string, { count: number, type: string }>()

    for (const chat of chats) {
        const uniqueDomains = new Set(chat.sources.map(s => s.domain))
        for (const domain of uniqueDomains) {
            const sourceInfo = chat.sources.find(s => s.domain === domain)
            const existing = sourceMap.get(domain) || { count: 0, type: sourceInfo?.source_type || 'OTHER' }
            sourceMap.set(domain, { count: existing.count + 1, type: existing.type })
        }
    }

    const topSources = Array.from(sourceMap.entries()).map(([domain, data]) => ({
        domain,
        source_type: data.type,
        usage_percentage: (data.count / totalChats) * 100
    })).sort((a, b) => b.usage_percentage - a.usage_percentage)

    return {
        brand: {
            visibility: brandStats.visibility ?? 0,
            avg_position: brandStats.avg_position ?? 0,
            avg_sentiment: brandStats.avg_sentiment ?? 0,
            delta_visibility: deltaValue(brandStats.visibility, previousBrandStats?.visibility ?? null),
            delta_position: deltaValue(brandStats.avg_position, previousBrandStats?.avg_position ?? null, true),
            delta_sentiment: deltaValue(brandStats.avg_sentiment, previousBrandStats?.avg_sentiment ?? null)
        },
        competitors,
        topSources
    }
}

export async function getVisibilityTimeSeries(project_id: string, filters?: DashboardFilters) {
    const chatWhere = buildChatWhere(project_id, filters || {})

    const chats = await prisma.chat.findMany({
        where: chatWhere,
        include: {
            brand_mentions: true,
            run: { select: { ran_at: true } }
        },
        orderBy: { created_at: 'asc' }
    })

    const dayMap = new Map<string, { total: number; brandHit: number; competitorHits: Map<string, number> }>()

    const project = await prisma.project.findUniqueOrThrow({
        where: { id: project_id },
        include: { competitors: true }
    })

    for (const chat of chats) {
        const dateKey = chat.run.ran_at.toISOString().slice(0, 10)
        const existing = dayMap.get(dateKey) ?? {
            total: 0,
            brandHit: 0,
            competitorHits: new Map<string, number>()
        }

        existing.total += 1
        if (chat.brand_mentioned) existing.brandHit += 1

        for (const mention of chat.brand_mentions) {
            const count = existing.competitorHits.get(mention.brand_name) ?? 0
            existing.competitorHits.set(mention.brand_name, count + 1)
        }

        dayMap.set(dateKey, existing)
    }

    const competitorNames = project.competitors.map(c => c.name)

    return Array.from(dayMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => {
            const brands: Record<string, number> = {
                [project.brand_name]: data.total > 0 ? (data.brandHit / data.total) * 100 : 0
            }
            for (const name of competitorNames) {
                const hits = data.competitorHits.get(name) ?? 0
                brands[name] = data.total > 0 ? (hits / data.total) * 100 : 0
            }
            return { date, total_chats: data.total, brands }
        })
}

export async function getRecentChats(project_id: string, filters?: DashboardFilters, limit = 9) {
    const chatWhere = buildChatWhere(project_id, filters || {})

    const chats = await prisma.chat.findMany({
        where: chatWhere,
        include: {
            brand_mentions: { select: { brand_name: true, sentiment_score: true, position: true } },
            sources: { select: { domain: true, url: true, title: true } },
            prompt: { select: { text: true } },
            run: { select: { ran_at: true } }
        },
        orderBy: { created_at: 'desc' },
        take: limit
    })

    return chats.map(chat => ({
        id: chat.id,
        ai_model: chat.ai_model,
        prompt_text: chat.prompt.text,
        excerpt: chat.raw_response.slice(0, 200).replace(/\n/g, ' '),
        raw_response: chat.raw_response,
        answer_blocks: chat.answer_blocks,
        brand_mentioned: chat.brand_mentioned,
        brand_position: chat.brand_position,
        sentiment_score: chat.sentiment_score,
        brands: chat.brand_mentions.map(m => m.brand_name),
        brand_details: chat.brand_mentions,
        sources: chat.sources,
        ran_at: chat.run.ran_at
    }))
}

export async function getChatsPage(project_id: string, filters?: DashboardFilters, page = 1, pageSize = 20) {
    const chatWhere = buildChatWhere(project_id, filters || {})
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 50)

    const [total, chats] = await Promise.all([
        prisma.chat.count({ where: chatWhere }),
        prisma.chat.findMany({
            where: chatWhere,
            include: {
                brand_mentions: { select: { brand_name: true, sentiment_score: true, position: true } },
                sources: { select: { domain: true, url: true, title: true } },
                prompt: { select: { text: true } },
                run: { select: { ran_at: true } }
            },
            orderBy: { created_at: 'desc' },
            skip: (safePage - 1) * safePageSize,
            take: safePageSize
        })
    ])

    return {
        data: chats.map(chat => ({
            id: chat.id,
            ai_model: chat.ai_model,
            prompt_text: chat.prompt.text,
            excerpt: chat.raw_response.slice(0, 200).replace(/\n/g, ' '),
            raw_response: chat.raw_response,
            answer_blocks: chat.answer_blocks,
            brand_mentioned: chat.brand_mentioned,
            brand_position: chat.brand_position,
            sentiment_score: chat.sentiment_score,
            brands: chat.brand_mentions.map(m => m.brand_name),
            brand_details: chat.brand_mentions,
            sources: chat.sources,
            ran_at: chat.run.ran_at
        })),
        page: safePage,
        page_size: safePageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / safePageSize))
    }
}
