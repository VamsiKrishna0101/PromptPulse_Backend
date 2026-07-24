import prisma from "../../../lib/prisma"
import { formatDate, formatNumber, formatPercent } from "./format"
import type { InternalMcpToolResult } from "./types"

type PerformanceData = {
    total_chats: number
    brand_visibility: number
    average_position: number | null
    average_sentiment: number | null
    comparison_catalog: PerformanceComparisonCatalog
}

export async function getSaraPerformanceTool(project_id: string): Promise<InternalMcpToolResult<PerformanceData>> {
    const [project, chats, latestRun] = await Promise.all([
        prisma.project.findUniqueOrThrow({
            where: { id: project_id },
            include: { competitors: { select: { name: true } } },
        }),
        prisma.chat.findMany({
            where: { run: { project_id } },
            include: {
                prompt: { select: { text: true, topic: true } },
                brand_mentions: true,
                sources: true,
                run: { select: { ran_at: true } },
            },
            orderBy: { created_at: "desc" },
            take: 1000,
        }),
        prisma.run.findFirst({
            where: { project_id },
            orderBy: { ran_at: "desc" },
            include: {
                scrape_jobs: {
                    select: { status: true, engine: true, error_reason: true },
                },
            },
        }),
    ])

    const totalChats = chats.length
    const brandHits = chats.filter(chat => chat.brand_mentioned)
    const visibility = totalChats ? (brandHits.length / totalChats) * 100 : 0
    const avgPosition = average(brandHits.map(chat => chat.brand_position).filter(isNumber))
    const avgSentiment = average(brandHits.map(chat => chat.sentiment_score).filter(isNumber))
    const comparisonCatalog = buildPerformanceComparisonCatalog(chats)

    const trackedNames = new Set(project.competitors.map(competitor => normalizeName(competitor.name)))
    const competitorStats = new Map<string, { mentions: number; positions: number[]; sentiments: number[] }>()
    const promptStats = new Map<string, { prompt: string; topic: string; total: number; hits: number; sentiments: number[] }>()

    for (const chat of chats) {
        const key = chat.prompt_id
        const promptData = promptStats.get(key) ?? {
            prompt: chat.prompt.text,
            topic: chat.prompt.topic,
            total: 0,
            hits: 0,
            sentiments: [],
        }
        promptData.total += 1
        if (chat.brand_mentioned) promptData.hits += 1
        if (isNumber(chat.sentiment_score)) promptData.sentiments.push(chat.sentiment_score)
        promptStats.set(key, promptData)

        for (const mention of chat.brand_mentions) {
            if (!trackedNames.has(normalizeName(mention.brand_name))) continue
            const current = competitorStats.get(mention.brand_name) ?? { mentions: 0, positions: [], sentiments: [] }
            current.mentions += 1
            if (isNumber(mention.position)) current.positions.push(mention.position)
            if (isNumber(mention.sentiment_score)) current.sentiments.push(mention.sentiment_score)
            competitorStats.set(mention.brand_name, current)
        }
    }

    const topPrompts = Array.from(promptStats.values())
        .sort((a, b) => (b.hits / b.total) - (a.hits / a.total))
        .slice(0, 5)
        .map(item => `${item.topic}: ${formatPercent((item.hits / item.total) * 100)} visibility across ${item.total} response(s)`)

    const weakPrompts = Array.from(promptStats.values())
        .sort((a, b) => (a.hits / a.total) - (b.hits / b.total))
        .slice(0, 5)
        .map(item => `${item.topic}: ${formatPercent((item.hits / item.total) * 100)} visibility for "${item.prompt}"`)

    const trackedCompetitors = Array.from(competitorStats.entries())
        .sort(([, a], [, b]) => b.mentions - a.mentions)
        .slice(0, 8)
        .map(([name, stats]) => `${name}: ${stats.mentions} mention(s), avg position ${formatNumber(average(stats.positions))}, sentiment ${formatNumber(average(stats.sentiments))}`)

    const jobCounts = summarizeJobs(latestRun?.scrape_jobs ?? [])
    const failedExamples = (latestRun?.scrape_jobs ?? [])
        .filter(job => job.status === "FAILED" && job.error_reason)
        .slice(0, 3)
        .map(job => `${job.engine}: ${job.error_reason}`)

    return {
        tool_name: "get_visibility_performance",
        title: "Live Visibility Performance",
        data: {
            total_chats: totalChats,
            brand_visibility: visibility,
            average_position: avgPosition,
            average_sentiment: avgSentiment,
            comparison_catalog: comparisonCatalog,
        },
        section: {
            title: "Live Visibility Performance",
            lines: [
                `Tool: get_visibility_performance`,
                `Total analyzed AI responses: ${totalChats}`,
                `Brand visibility: ${formatPercent(visibility)}`,
                `Average brand position: ${formatNumber(avgPosition)}`,
                `Average sentiment: ${formatNumber(avgSentiment)}`,
                formatDailyComparisonLine("Today vs yesterday", comparisonCatalog.today_vs_yesterday),
                formatPeriodComparisonLine("This week vs previous week", comparisonCatalog.this_week_vs_previous_week),
                formatRecentDailyStatsLine(comparisonCatalog.recent_daily_stats),
                "Instruction: For time comparison questions, use the matching comparison line or the recent daily stats list first. If the requested date/window has no analyzed responses, say that exact missing date/window prevents a real comparison. Do not answer with only all-time/current snapshot numbers.",
                latestRun ? `Latest run: ${latestRun.status} at ${formatDate(latestRun.ran_at)}` : "No visibility run has completed yet.",
                latestRun ? `Latest run jobs: ${jobCounts}` : null,
                topPrompts.length ? `Strong prompts: ${topPrompts.join(" | ")}` : null,
                weakPrompts.length ? `Weak prompts to inspect: ${weakPrompts.join(" | ")}` : null,
                trackedCompetitors.length ? `Tracked competitor signals: ${trackedCompetitors.join(" | ")}` : "No tracked competitor mentions found yet.",
                failedExamples.length ? `Recent failed scrape examples: ${failedExamples.join(" | ")}` : null,
            ],
        },
    }
}

type DailyStats = {
    date: string
    total_chats: number
    visibility: number | null
    average_position: number | null
    average_sentiment: number | null
}

type DailyComparison = {
    timezone: "Asia/Kolkata"
    current: DailyStats
    previous: DailyStats
    delta_visibility: number | null
    delta_position: number | null
    delta_sentiment: number | null
    delta_responses: number
}

type PeriodStats = {
    label: string
    date_range: string
    total_chats: number
    visibility: number | null
    average_position: number | null
    average_sentiment: number | null
}

type PeriodComparison = {
    timezone: "Asia/Kolkata"
    current: PeriodStats
    previous: PeriodStats
    delta_visibility: number | null
    delta_position: number | null
    delta_sentiment: number | null
    delta_responses: number
}

type PerformanceComparisonCatalog = {
    timezone: "Asia/Kolkata"
    today_vs_yesterday: DailyComparison
    this_week_vs_previous_week: PeriodComparison
    recent_daily_stats: DailyStats[]
}

type DailyChat = {
    brand_mentioned: boolean
    brand_position: number | null
    sentiment_score: number | null
    created_at: Date
    run: { ran_at: Date }
}

function buildPerformanceComparisonCatalog(chats: DailyChat[]): PerformanceComparisonCatalog {
    const now = new Date()
    const todayKey = indiaDateKey(now)
    const yesterdayKey = indiaDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))
    const today = aggregateDailyStats(todayKey, chats.filter(chat => indiaDateKey(chat.run?.ran_at ?? chat.created_at) === todayKey))
    const yesterday = aggregateDailyStats(yesterdayKey, chats.filter(chat => indiaDateKey(chat.run?.ran_at ?? chat.created_at) === yesterdayKey))
    const thisWeekKeys = weekToDateKeys(now)
    const previousWeekKeys = new Set(Array.from(thisWeekKeys).map(key => shiftDateKey(key, -7)))
    const thisWeekChats = chats.filter(chat => thisWeekKeys.has(indiaDateKey(chat.run?.ran_at ?? chat.created_at)))
    const previousWeekChats = chats.filter(chat => previousWeekKeys.has(indiaDateKey(chat.run?.ran_at ?? chat.created_at)))
    const thisWeek = aggregatePeriodStats("this week to date", formatDateRange(thisWeekKeys), thisWeekChats)
    const previousWeek = aggregatePeriodStats("previous week same days", formatDateRange(previousWeekKeys), previousWeekChats)
    const recentDailyStats = recentDateKeys(now, 30).map(date => (
        aggregateDailyStats(date, chats.filter(chat => indiaDateKey(chat.run?.ran_at ?? chat.created_at) === date))
    ))

    return {
        timezone: "Asia/Kolkata",
        today_vs_yesterday: {
            timezone: "Asia/Kolkata",
            current: today,
            previous: yesterday,
            delta_visibility: deltaValue(today.visibility, yesterday.visibility),
            delta_position: deltaValue(today.average_position, yesterday.average_position, true),
            delta_sentiment: deltaValue(today.average_sentiment, yesterday.average_sentiment),
            delta_responses: today.total_chats - yesterday.total_chats,
        },
        this_week_vs_previous_week: {
            timezone: "Asia/Kolkata",
            current: thisWeek,
            previous: previousWeek,
            delta_visibility: deltaValue(thisWeek.visibility, previousWeek.visibility),
            delta_position: deltaValue(thisWeek.average_position, previousWeek.average_position, true),
            delta_sentiment: deltaValue(thisWeek.average_sentiment, previousWeek.average_sentiment),
            delta_responses: thisWeek.total_chats - previousWeek.total_chats,
        },
        recent_daily_stats: recentDailyStats,
    }
}

function aggregateDailyStats(date: string, chats: DailyChat[]): DailyStats {
    const brandHits = chats.filter(chat => chat.brand_mentioned)
    return {
        date,
        total_chats: chats.length,
        visibility: chats.length ? (brandHits.length / chats.length) * 100 : null,
        average_position: average(brandHits.map(chat => chat.brand_position).filter(isNumber)),
        average_sentiment: average(brandHits.map(chat => chat.sentiment_score).filter(isNumber)),
    }
}

function aggregatePeriodStats(label: string, dateRange: string, chats: DailyChat[]): PeriodStats {
    const brandHits = chats.filter(chat => chat.brand_mentioned)
    return {
        label,
        date_range: dateRange,
        total_chats: chats.length,
        visibility: chats.length ? (brandHits.length / chats.length) * 100 : null,
        average_position: average(brandHits.map(chat => chat.brand_position).filter(isNumber)),
        average_sentiment: average(brandHits.map(chat => chat.sentiment_score).filter(isNumber)),
    }
}

function indiaDateKey(value: Date) {
    return new Date(value.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10)
}

function weekToDateKeys(value: Date) {
    const todayKey = indiaDateKey(value)
    const today = parseDateKeyAsUtc(todayKey)
    const day = today.getUTCDay()
    const daysSinceMonday = (day + 6) % 7
    const keys = new Set<string>()
    for (let offset = daysSinceMonday; offset >= 0; offset--) {
        keys.add(shiftDateKey(todayKey, -offset))
    }
    return keys
}

function recentDateKeys(value: Date, days: number) {
    const todayKey = indiaDateKey(value)
    return Array.from({ length: days }, (_item, index) => shiftDateKey(todayKey, -index))
}

function shiftDateKey(dateKey: string, days: number) {
    const date = parseDateKeyAsUtc(dateKey)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
}

function parseDateKeyAsUtc(dateKey: string) {
    return new Date(`${dateKey}T00:00:00.000Z`)
}

function formatDateRange(keys: Set<string>) {
    const sorted = Array.from(keys).sort()
    if (sorted.length === 0) return "n/a"
    return sorted.length === 1 ? sorted[0] : `${sorted[0]} to ${sorted[sorted.length - 1]}`
}

function deltaValue(current: number | null, previous: number | null, lowerIsBetter = false) {
    if (current === null || previous === null) return null
    const diff = current - previous
    return lowerIsBetter ? -diff : diff
}

function formatSignedNumber(value: number | null, suffix = "", digits = 1) {
    if (value === null || !Number.isFinite(value)) return "n/a"
    const rounded = Number(value.toFixed(digits))
    return `${rounded > 0 ? "+" : ""}${rounded}${suffix}`
}

function formatDailyStats(stats: DailyStats) {
    if (stats.total_chats === 0) {
        return `${stats.date}: no analyzed responses`
    }
    return `${stats.date}: ${formatPercent(stats.visibility)} visibility, avg position ${formatNumber(stats.average_position)}, sentiment ${formatNumber(stats.average_sentiment)}, ${stats.total_chats} response(s)`
}

function formatPeriodStats(stats: PeriodStats) {
    if (stats.total_chats === 0) {
        return `${stats.label} (${stats.date_range}): no analyzed responses`
    }
    return `${stats.label} (${stats.date_range}): ${formatPercent(stats.visibility)} visibility, avg position ${formatNumber(stats.average_position)}, sentiment ${formatNumber(stats.average_sentiment)}, ${stats.total_chats} response(s)`
}

function formatDailyComparisonLine(label: string, comparison: DailyComparison) {
    return [
        `${label} (Asia/Kolkata):`,
        `current ${formatDailyStats(comparison.current)}`,
        `previous ${formatDailyStats(comparison.previous)}`,
        `deltas visibility ${formatSignedNumber(comparison.delta_visibility, " pts")}, position ${formatSignedNumber(comparison.delta_position)}, sentiment ${formatSignedNumber(comparison.delta_sentiment)}, responses ${formatSignedNumber(comparison.delta_responses, "", 0)}`,
    ].join(" ")
}

function formatPeriodComparisonLine(label: string, comparison: PeriodComparison) {
    return [
        `${label} (Asia/Kolkata):`,
        `current ${formatPeriodStats(comparison.current)}`,
        `previous ${formatPeriodStats(comparison.previous)}`,
        `deltas visibility ${formatSignedNumber(comparison.delta_visibility, " pts")}, position ${formatSignedNumber(comparison.delta_position)}, sentiment ${formatSignedNumber(comparison.delta_sentiment)}, responses ${formatSignedNumber(comparison.delta_responses, "", 0)}`,
    ].join(" ")
}

function formatRecentDailyStatsLine(stats: DailyStats[]) {
    const days = stats.map(formatDailyStats).join(" | ")
    return `Recent daily stats for particular-day comparisons, last 30 days (Asia/Kolkata): ${days}`
}

function summarizeJobs(jobs: Array<{ status: string }>) {
    if (jobs.length === 0) return "no jobs recorded"
    const counts = jobs.reduce<Record<string, number>>((acc, job) => {
        acc[job.status] = (acc[job.status] ?? 0) + 1
        return acc
    }, {})
    return Object.entries(counts).map(([status, count]) => `${status} ${count}`).join(", ")
}

function average(values: number[]) {
    if (values.length === 0) return null
    return values.reduce((sum, value) => sum + value, 0) / values.length
}

function isNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value)
}

function normalizeName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}
