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
    country?: string
    intent?: string
    mentioned?: boolean
    cited?: boolean
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

    if (filters.country && filters.country !== 'all') {
        where.AND = [
            ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
            {
                OR: [
                    { geo_country_code: filters.country },
                    { geo_country_name: { equals: filters.country, mode: 'insensitive' } },
                ],
            },
        ]
    }

    if (typeof filters.mentioned === 'boolean') {
        where.brand_mentioned = filters.mentioned
    }

    if (filters.cited === true) {
        where.sources = { some: { is_cited: true } }
    } else if (filters.cited === false) {
        where.sources = { none: { is_cited: true } }
    }
    
    const promptWhere: Prisma.PromptWhereInput = { project_id }
    let hasPromptFilter = false
    
    if (filters.topic && filters.topic !== 'all') {
        promptWhere.topic = filters.topic
        hasPromptFilter = true
    }

    if (filters.intent && filters.intent !== 'all') {
        promptWhere.type = filters.intent
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
        const searchCondition: Prisma.ChatWhereInput = {
          OR: [
            { raw_response: { contains: q, mode: 'insensitive' } },
            { prompt: { text: { contains: q, mode: 'insensitive' } } },
            { brand_mentions: { some: { brand_name: { contains: q, mode: 'insensitive' } } } },
            { sources: { some: { domain: { contains: q, mode: 'insensitive' } } } },
            { sources: { some: { title: { contains: q, mode: 'insensitive' } } } }
          ],
        }
        where.AND = [
          ...(where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : []),
          searchCondition,
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
        select: { topic: true, tags: true, type: true }
    })

    const topics = Array.from(new Set(prompts.map(p => p.topic).filter(Boolean)))
    const tags = Array.from(new Set(prompts.flatMap(p => p.tags).filter(Boolean)))
    const intents = Array.from(new Set(prompts.map(p => p.type).filter(Boolean)))
    const chats = await prisma.chat.findMany({
        where: { prompt: { project_id } },
        select: { geo_country_code: true, geo_country_name: true },
        distinct: ['geo_country_code', 'geo_country_name'],
    })
    const countries = chats
        .map(chat => ({ value: chat.geo_country_code || chat.geo_country_name || '', label: chat.geo_country_name || chat.geo_country_code || '' }))
        .filter(country => country.value && country.label)
        .sort((a, b) => a.label.localeCompare(b.label))

    return { topics, tags, intents, countries }
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

    const sourceRows = buildSourceRows(analysis.sources, citations ?? [])

    const chat = await prisma.chat.create({
        data: {
            run_id,
            prompt_id,
            geo_variant_id: geo_variant_id ?? null,
            geo_country_code: geo_country_code ?? null,
            geo_country_name: geo_country_name ?? null,
            geo_city: geo_city ?? null,
            ai_model,
            raw_response,  // always keep original scraper dump as truth
            display_response: null,
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
                    domain: m.domain ?? null,  // persist the real domain (peec.ai, profound.ai etc.)
                    position: m.position ?? null,
                    sentiment_score: m.sentiment_score ?? null
                }))
            },
            sources: {
                create: sourceRows
            }
        },
        include: {
            brand_mentions: true,
            sources: true
        }
    })

    if (input.enqueue_source_enrichment !== false && process.env.SOURCE_ENRICHMENT_AUTO_ENQUEUE !== "false") {
        try {
            const maxSources = Math.max(0, Number(process.env.SOURCE_ENRICHMENT_MAX_PER_CHAT ?? 8))
            const sources = maxSources > 0
                ? await prisma.source.findMany({
                    where: {
                        chat_id: chat.id,
                        url: { not: "" },
                        source_url_content_id: null,
                    },
                    select: { id: true },
                    orderBy: [
                        { is_cited: "desc" },
                        { created_at: "asc" },
                    ],
                    take: maxSources,
                })
                : []

            const queued = await Promise.allSettled(
                sources.map((source, index) => enqueueSourceEnrichment(source.id, index * 1000))
            )

            const failed = queued.filter(result => result.status === "rejected").length
            if (failed > 0) {
                console.warn("Some source enrichment jobs could not be queued", {
                    chat_id: chat.id,
                    failed,
                    total: queued.length,
                })
            }
        } catch (error) {
            console.warn("Source enrichment enqueue skipped", {
                chat_id: chat.id,
                error: error instanceof Error ? error.message : error,
            })
        }
    }

    if (input.ingest_chat !== false) {
        void ingestChatById(chat.id).catch(error => {
            console.warn("Sara chat ingestion failed", { chat_id: chat.id, error })
        })
    }

    return chat
}

function buildSourceRows(
    analysisSources: {
        url: string
        domain: string
        source_type: 'EDITORIAL' | 'CORPORATE' | 'UGC' | 'SOCIAL' | 'COMPETITOR' | 'YOU' | 'REFERENCE' | 'INSTITUTIONAL' | 'OTHER'
        is_cited: boolean
    }[],
    citations: {
        text: string
        url: string
        domain?: string | null
        snippet?: string | null
        position?: number | null
        answer_position?: number | null
        is_cited?: boolean
        source_kind?: string | null
    }[]
) {
    const rows: {
        url: string
        domain: string
        source_type: 'EDITORIAL' | 'CORPORATE' | 'UGC' | 'SOCIAL' | 'COMPETITOR' | 'YOU' | 'REFERENCE' | 'INSTITUTIONAL' | 'OTHER'
        url_type?: 'LISTICLE' | 'COMPARISON' | 'DISCUSSION' | 'ARTICLE' | 'DOCUMENTATION' | 'REVIEW' | 'SOCIAL_POST' | 'HOMEPAGE' | 'OTHER'
        is_cited: boolean
        used_by_ai?: boolean
        title?: string | null
        snippet?: string | null
        source_kind?: string | null
        source_position?: number | null
        answer_position?: number | null
    }[] = []
    const byKey = new Map<string, typeof rows[number]>()

    for (const source of analysisSources) {
        const url = source.url?.trim()
        const domain = source.domain?.trim() || safeDomain(url)
        if (!url && !domain) continue

        const row = {
            url: url || domain || "unknown-source",
            domain: domain || url || "unknown-source",
            source_type: source.source_type || "OTHER",
            is_cited: Boolean(source.is_cited),
            used_by_ai: true,
            source_kind: null,
            source_position: null,
            answer_position: null,
        }
        byKey.set(sourceKey(row.url, row.domain), row)
    }

    for (const citation of citations) {
        const url = citation.url?.trim()
        if (!url) continue
        const domain = citation.domain?.trim() || safeDomain(url)
        const key = sourceKey(url, domain)
        const existing = byKey.get(key)
        const title = citation.text && citation.text !== url ? citation.text : null
        const isCited = citation.is_cited ?? (citation.source_kind === "citation" || citation.source_kind === "attached_link")

        byKey.set(key, {
            url,
            domain,
            source_type: existing?.source_type ?? "OTHER",
            url_type: existing?.url_type ?? sourceKindToUrlType(citation.source_kind),
            is_cited: Boolean(citation.is_cited !== undefined ? isCited : existing?.is_cited || isCited),
            used_by_ai: true,
            title: existing?.title ?? title,
            snippet: existing?.snippet ?? citation.snippet ?? null,
            source_kind: existing?.source_kind ?? citation.source_kind ?? null,
            source_position: existing?.source_position ?? citation.position ?? null,
            answer_position: existing?.answer_position ?? citation.answer_position ?? null,
        })
    }

    rows.push(...byKey.values())
    return rows
}

function sourceKindToUrlType(sourceKind: string | null | undefined) {
    if (sourceKind === "reference") return "DOCUMENTATION"
    return "OTHER"
}

function sourceKey(url: string | null | undefined, domain: string | null | undefined) {
    return (url?.trim() || domain?.trim() || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")
}

function safeDomain(url: string | null | undefined) {
    if (!url) return ""
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
        select: {
            created_at: true,
            brand_mentioned: true,
            brand_position: true,
            sentiment_score: true,
            brand_mentions: {
                select: {
                    brand_name: true,
                    position: true,
                    sentiment_score: true,
                },
            },
            sources: {
                select: {
                    domain: true,
                    source_type: true,
                },
            },
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
        const previousChats = await prisma.chat.findMany({
            where: previousWhere,
            select: {
                brand_mentioned: true,
                brand_position: true,
                sentiment_score: true,
            },
        })
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
        select: {
            created_at: true,
            brand_mentioned: true,
            brand_mentions: {
                select: {
                    brand_name: true,
                },
            },
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
            sources: {
                select: {
                    domain: true,
                    url: true,
                    title: true,
                    snippet: true,
                    is_cited: true,
                    source_type: true,
                    url_type: true,
                    source_kind: true,
                    source_position: true,
                    answer_position: true,
                },
                orderBy: [
                    { is_cited: "desc" },
                    { answer_position: "asc" },
                    { source_position: "asc" },
                    { created_at: "asc" },
                ],
            },
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
        excerpt: (chat.display_response || chat.raw_response)
            .replace(/[#*`\[\]>]/g, '')
            .replace(/\n/g, ' ')
            .slice(0, 200),
        raw_response: chat.raw_response,
        display_response: chat.display_response ?? null,
        answer_blocks: chat.answer_blocks,
        brand_mentioned: chat.brand_mentioned,
        brand_position: chat.brand_position,
        sentiment_score: chat.sentiment_score,
        brands: chat.brand_mentions.map(m => m.brand_name),
        brand_details: chat.brand_mentions,
        sources: chat.sources,
        screenshot_path: chat.screenshot_path,
        has_screenshot: Boolean(chat.screenshot_path?.startsWith("gs://")),
        ran_at: chat.run.ran_at
    }))
}

export async function getChatsPage(project_id: string, filters?: DashboardFilters, page = 1, pageSize = 10) {
    const chatWhere = buildChatWhere(project_id, filters || {})
    const safePage = Math.max(1, page)
    const safePageSize = Math.min(Math.max(1, pageSize), 50)

    const [total, chats] = await Promise.all([
        prisma.chat.count({ where: chatWhere }),
        prisma.chat.findMany({
            where: chatWhere,
            include: {
                brand_mentions: { select: { brand_name: true, sentiment_score: true, position: true } },
                sources: {
                    select: {
                        domain: true,
                        url: true,
                        title: true,
                        snippet: true,
                        is_cited: true,
                        source_type: true,
                        url_type: true,
                        source_kind: true,
                        source_position: true,
                        answer_position: true,
                    },
                    orderBy: [
                        { is_cited: "desc" },
                        { answer_position: "asc" },
                        { source_position: "asc" },
                        { created_at: "asc" },
                    ],
                },
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
            excerpt: (chat.display_response || chat.raw_response)
                .replace(/[#*`\[\]>]/g, '') // strip markdown symbols for cleaner preview
                .replace(/\n/g, ' ')
                .slice(0, 200),
            raw_response: chat.raw_response,
            display_response: chat.display_response ?? null,
            answer_blocks: chat.answer_blocks,
            brand_mentioned: chat.brand_mentioned,
            brand_position: chat.brand_position,
            sentiment_score: chat.sentiment_score,
            brands: chat.brand_mentions.map(m => m.brand_name),
            brand_details: chat.brand_mentions,
            sources: chat.sources,
            screenshot_path: chat.screenshot_path,
            has_screenshot: Boolean(chat.screenshot_path?.startsWith("gs://")),
            ran_at: chat.run.ran_at
        })),
        page: safePage,
        page_size: safePageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / safePageSize))
    }
}
