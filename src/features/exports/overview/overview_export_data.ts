import { Prisma } from "@prisma/client"
import prisma from "../../../lib/prisma"
import { getOpportunities } from "../../opportunities/opportunity_service"
import type { DashboardFilters } from "../../dashboard/dashboard_service"
import type { ExportFilters } from "../export_types"
import {
    average,
    buildActionPlan,
    buildExecutiveNarrative,
    canonicalBrandKey,
    displayEngine,
    metric,
    percent,
    promptStatus,
    round,
} from "./overview_export_model"
import type {
    OverviewBrandRow,
    OverviewEngineRow,
    OverviewExportModel,
    OverviewPromptRow,
    OverviewSourceRow,
} from "./overview_export_types"

type ReportChat = Prisma.ChatGetPayload<{
    include: {
        prompt: true
        brand_mentions: true
        sources: true
        run: { select: { ran_at: true } }
    }
}>

const DAY_MS = 24 * 60 * 60 * 1000

function periodStart(days?: number) {
    return days ? new Date(Date.now() - days * DAY_MS) : null
}

function chatWhere(projectId: string, filters: ExportFilters, dateRange?: Prisma.DateTimeFilter): Prisma.ChatWhereInput {
    return {
        prompt: {
            project_id: projectId,
            ...(filters.topic ? { topic: filters.topic } : {}),
        },
        ...(dateRange ? { created_at: dateRange } : filters.days ? { created_at: { gte: periodStart(filters.days)! } } : {}),
        ...(filters.model ? { ai_model: { contains: filters.model, mode: "insensitive" } } : {}),
        ...(filters.q ? {
            OR: [
                { prompt: { text: { contains: filters.q, mode: "insensitive" } } },
                { raw_response: { contains: filters.q, mode: "insensitive" } },
                { sources: { some: { domain: { contains: filters.q, mode: "insensitive" } } } },
            ],
        } : {}),
    }
}

function ownStats(chats: ReportChat[]) {
    const mentioned = chats.filter(chat => chat.brand_mentioned)
    return {
        total: chats.length,
        mentioned: mentioned.length,
        visibility: percent(mentioned.length, chats.length),
        position: average(mentioned.map(chat => chat.brand_position)),
        sentiment: average(mentioned.map(chat => chat.sentiment_score)),
        domains: new Set(chats.flatMap(chat => chat.sources.map(source => source.domain))).size,
    }
}

function toBrandList(chats: ReportChat[], ownBrand: string): OverviewBrandRow[] {
    const total = chats.length
    const ownKey = canonicalBrandKey(ownBrand)
    const map = new Map<string, {
        label: string
        chats: Set<string>
        positions: number[]
        sentiments: number[]
        own: boolean
    }>()

    const ensure = (label: string, own = false) => {
        const key = own ? ownKey : canonicalBrandKey(label)
        const existing = map.get(key)
        if (existing) {
            if (own) existing.own = true
            return existing
        }
        const created = { label: own ? ownBrand : label.trim(), chats: new Set<string>(), positions: [] as number[], sentiments: [] as number[], own }
        map.set(key, created)
        return created
    }

    const own = ensure(ownBrand, true)
    for (const chat of chats) {
        if (chat.brand_mentioned) {
            own.chats.add(chat.id)
            if (chat.brand_position !== null) own.positions.push(chat.brand_position)
            if (chat.sentiment_score !== null) own.sentiments.push(chat.sentiment_score)
        }
        for (const mention of chat.brand_mentions) {
            const isOwn = canonicalBrandKey(mention.brand_name) === ownKey
            const item = ensure(mention.brand_name, isOwn)
            item.chats.add(chat.id)
            if (mention.position !== null) item.positions.push(mention.position)
            if (mention.sentiment_score !== null) item.sentiments.push(mention.sentiment_score)
        }
    }

    return [...map.values()]
        .map(item => ({
            rank: 0,
            brand: item.own ? ownBrand : item.label,
            visibility: percent(item.chats.size, total),
            mentions: item.chats.size,
            position: average(item.positions),
            sentiment: average(item.sentiments),
            isOwnBrand: item.own,
        }))
        .sort((a, b) => b.visibility - a.visibility || a.brand.localeCompare(b.brand))
        .slice(0, 12)
        .map((item, index) => ({ ...item, rank: index + 1 }))
}

function toEngineList(chats: ReportChat[]): OverviewEngineRow[] {
    const groups = new Map<string, ReportChat[]>()
    for (const chat of chats) {
        const engine = displayEngine(chat.ai_model)
        groups.set(engine, [...(groups.get(engine) ?? []), chat])
    }
    return [...groups.entries()]
        .map(([engine, rows]) => {
            const stats = ownStats(rows)
            return {
                engine,
                responses: rows.length,
                visibility: stats.visibility,
                position: stats.position,
                sentiment: stats.sentiment,
                sourceDomains: stats.domains,
            }
        })
        .sort((a, b) => b.responses - a.responses || b.visibility - a.visibility)
}

function toPromptList(chats: ReportChat[]): OverviewPromptRow[] {
    const groups = new Map<string, ReportChat[]>()
    for (const chat of chats) groups.set(chat.prompt_id, [...(groups.get(chat.prompt_id) ?? []), chat])
    return [...groups.entries()]
        .map(([promptId, rows]) => {
            const stats = ownStats(rows)
            return {
                promptId,
                prompt: rows[0].prompt.text,
                topic: rows[0].prompt.topic || "Uncategorized",
                responses: rows.length,
                visibility: stats.visibility,
                position: stats.position,
                sentiment: stats.sentiment,
                status: promptStatus(stats.visibility),
            }
        })
        .sort((a, b) => a.visibility - b.visibility || b.responses - a.responses)
        .slice(0, 30)
}

function stringArray(value: Prisma.JsonValue | null | undefined) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function toSourceList(chats: ReportChat[], ownBrand: string): OverviewSourceRow[] {
    const ownKey = canonicalBrandKey(ownBrand)
    const map = new Map<string, {
        chats: Set<string>
        title: string
        type: string
        citations: number
        url: string
        confirmed: boolean
    }>()
    for (const chat of chats) {
        for (const source of chat.sources) {
            const key = source.domain.trim().toLowerCase()
            if (!key) continue
            const item = map.get(key) ?? {
                chats: new Set<string>(),
                title: source.title ?? "",
                type: source.source_type,
                citations: 0,
                url: source.url,
                confirmed: false,
            }
            item.chats.add(chat.id)
            if (!item.title && source.title) item.title = source.title
            if (source.is_cited) item.citations += 1
            if (stringArray(source.mentioned_brands).some(name => canonicalBrandKey(name) === ownKey)) item.confirmed = true
            map.set(key, item)
        }
    }
    return [...map.entries()]
        .map(([domain, item]) => ({
            rank: 0,
            domain,
            title: item.title,
            usedPct: percent(item.chats.size, chats.length),
            sourceType: item.type,
            citations: item.citations,
            url: item.url || `https://${domain}`,
            brandPresence: item.confirmed ? "CONFIRMED" as const : "NOT_CONFIRMED" as const,
        }))
        .sort((a, b) => b.usedPct - a.usedPct || b.citations - a.citations)
        .slice(0, 30)
        .map((item, index) => ({ ...item, rank: index + 1 }))
}

function toTrend(chats: ReportChat[]) {
    const days = new Map<string, ReportChat[]>()
    for (const chat of chats) {
        const date = chat.run.ran_at.toISOString().slice(0, 10)
        days.set(date, [...(days.get(date) ?? []), chat])
    }
    return [...days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, rows]) => ({ date, visibility: ownStats(rows).visibility, responses: rows.length }))
        .slice(-30)
}

function toTopicList(chats: ReportChat[]) {
    const groups = new Map<string, ReportChat[]>()
    for (const chat of chats) {
        const topic = chat.prompt.topic?.trim() || "Uncategorized"
        groups.set(topic, [...(groups.get(topic) ?? []), chat])
    }
    return [...groups.entries()]
        .map(([topic, rows]) => {
            const stats = ownStats(rows)
            return {
                topic,
                prompts: new Set(rows.map(row => row.prompt_id)).size,
                responses: rows.length,
                visibility: stats.visibility,
                position: stats.position,
            }
        })
        .sort((a, b) => b.responses - a.responses || b.visibility - a.visibility)
}

function toSourceTypes(sources: OverviewExportModel["sources"]) {
    const groups = new Map<string, OverviewExportModel["sources"]>()
    for (const source of sources) {
        groups.set(source.sourceType, [...(groups.get(source.sourceType) ?? []), source])
    }
    return [...groups.entries()]
        .map(([sourceType, rows]) => ({
            sourceType,
            domains: rows.length,
            citations: rows.reduce((sum, row) => sum + row.citations, 0),
            confirmedDomains: rows.filter(row => row.brandPresence === "CONFIRMED").length,
        }))
        .sort((a, b) => b.citations - a.citations)
}

function toSentiment(chats: ReportChat[]) {
    const scores = chats
        .map(chat => chat.sentiment_score)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    return {
        scoredResponses: scores.length,
        positive: scores.filter(score => score >= 67).length,
        neutral: scores.filter(score => score >= 34 && score < 67).length,
        negative: scores.filter(score => score < 34).length,
        average: average(scores),
    }
}

export async function getOverviewExportModel(projectId: string, filters: ExportFilters): Promise<OverviewExportModel> {
    const start = periodStart(filters.days)
    const previousRange = filters.days && start
        ? { gte: new Date(start.getTime() - filters.days * DAY_MS), lt: start }
        : null

    const [project, chats, previousChats, activePrompts, runs, jobs, opportunityResult] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { brand_name: true, brand_url: true } }),
        prisma.chat.findMany({
            where: chatWhere(projectId, filters),
            include: { prompt: true, brand_mentions: true, sources: true, run: { select: { ran_at: true } } },
            orderBy: { created_at: "asc" },
            take: 5000,
        }),
        previousRange
            ? prisma.chat.findMany({
                where: chatWhere(projectId, { ...filters, days: undefined }, previousRange),
                include: { prompt: true, brand_mentions: true, sources: true, run: { select: { ran_at: true } } },
                orderBy: { created_at: "asc" },
                take: 5000,
            })
            : Promise.resolve([] as ReportChat[]),
        prisma.prompt.count({ where: { project_id: projectId, is_active: true } }),
        prisma.run.groupBy({
            by: ["status"],
            where: { project_id: projectId, ...(start ? { ran_at: { gte: start } } : {}) },
            _count: { _all: true },
        }),
        prisma.scrapeJob.groupBy({
            by: ["status"],
            where: { project_id: projectId, ...(start ? { created_at: { gte: start } } : {}) },
            _count: { _all: true },
        }),
        getOpportunities(projectId, {
            days: filters.days,
            model: filters.model,
            topic: filters.topic,
            q: filters.q,
        } satisfies DashboardFilters).catch(() => ({ summary: { total: 0 }, opportunities: [] })),
    ])

    const current = ownStats(chats)
    const previous = previousChats.length ? ownStats(previousChats) : null
    const metrics = [
        metric({ label: "AI responses", value: current.total, previous: previous?.total ?? null, description: "Successful analyzed responses", format: "number" }),
        metric({ label: "Brand visibility", value: current.visibility, previous: previous?.visibility ?? null, description: "Responses mentioning the brand", format: "percent" }),
        metric({ label: "Average position", value: current.position ?? 0, previous: previous?.position ?? null, description: "Rank when the brand appears", format: "position", lowerIsBetter: true }),
        metric({ label: "Sentiment score", value: current.sentiment ?? 0, previous: previous?.sentiment ?? null, description: "Average measured brand sentiment", format: "score" }),
        metric({ label: "Source domains", value: current.domains, previous: previous?.domains ?? null, description: "Distinct domains in answers", format: "number" }),
    ]
    const engines = toEngineList(chats)
    const prompts = toPromptList(chats)
    const topics = toTopicList(chats)
    const brands = toBrandList(chats, project.brand_name)
    const sources = toSourceList(chats, project.brand_name)
    const sourceTypes = toSourceTypes(sources)
    const sentiment = toSentiment(chats)
    const opportunities = opportunityResult.opportunities.slice(0, 10).map(item => ({
        title: item.title,
        prompt: item.prompt_text,
        competitor: item.competitor_name,
        impact: item.impact,
        effort: item.effort,
        score: round(item.impact_score),
        nextStep: item.next_step,
    }))
    const topCompetitor = brands.find(brand => !brand.isOwnBrand)?.brand ?? null
    const narrative = buildExecutiveNarrative({
        brandName: project.brand_name,
        metrics,
        engines,
        prompts,
        competitorName: topCompetitor,
        opportunities: opportunities.length,
    })
    const runCount = (status: string) => runs.find(row => row.status === status)?._count._all ?? 0
    const jobCount = (status: string) => jobs.find(row => row.status === status)?._count._all ?? 0
    const actions = buildActionPlan({
        brandName: project.brand_name,
        engines,
        prompts,
        sources,
        competitors: brands,
        opportunities,
    })

    return {
        brandName: project.brand_name,
        brandUrl: project.brand_url,
        generatedAt: new Date(),
        filters,
        periodLabel: filters.days ? `Last ${filters.days} days` : "All available data",
        comparisonLabel: filters.days ? `Previous ${filters.days} days` : null,
        metrics,
        trend: toTrend(chats),
        engines,
        prompts,
        topics,
        brands,
        sources,
        sourceTypes,
        sentiment,
        opportunities,
        actions,
        evidence: [...chats].reverse().slice(0, 24).map(chat => ({
            date: chat.run.ran_at,
            engine: displayEngine(chat.ai_model),
            prompt: chat.prompt.text,
            mentioned: chat.brand_mentioned,
            position: chat.brand_position,
            sentiment: chat.sentiment_score,
            source: chat.sources.find(source => source.is_cited)?.domain ?? chat.sources[0]?.domain ?? "",
        })),
        coverage: {
            activePrompts,
            representedPrompts: new Set(chats.map(chat => chat.prompt_id)).size,
            responses: chats.length,
            successfulRuns: runCount("SUCCESS"),
            partialRuns: runCount("PARTIAL_SUCCESS"),
            failedRuns: runCount("FAILED"),
            completedJobs: jobCount("SUCCESS"),
            failedJobs: jobCount("FAILED") + jobCount("MANUAL_NEEDED") + jobCount("RATE_LIMITED"),
            firstResponseAt: chats[0]?.created_at ?? null,
            lastResponseAt: chats.at(-1)?.created_at ?? null,
        },
        ...narrative,
        methodology: [
            "Visibility is the share of successfully analyzed AI responses that mention the tracked brand.",
            "Average position is calculated only for responses where the tracked brand is present; lower is better.",
            "Brand names are normalized case-insensitively before aggregation to prevent duplicate leaderboard entries.",
            "Engine, prompt, competitor, sentiment, and source metrics reuse stored response evidence; this export makes no new provider or LLM calls.",
            "Confirmed source brand presence is shown only when structured source metadata explicitly contains the tracked brand. It is not inferred from the surrounding AI answer.",
            "Previous-period changes are shown only when a finite day filter is selected and evidence exists in the immediately preceding period.",
            "Results reflect successful stored responses and the filters active when the report was generated.",
        ],
    }
}
