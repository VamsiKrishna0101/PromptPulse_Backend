import prisma from "../../../lib/prisma"
import { formatDate, formatNumber, formatPercent, type SaraContextSection } from "./context_format"

export async function buildSaraPerformanceContext(project_id: string): Promise<SaraContextSection> {
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
            take: 300,
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
        title: "Live Visibility Performance",
        lines: [
            `Total analyzed AI responses: ${totalChats}`,
            `Brand visibility: ${formatPercent(visibility)}`,
            `Average brand position: ${formatNumber(avgPosition)}`,
            `Average sentiment: ${formatNumber(avgSentiment)}`,
            latestRun ? `Latest run: ${latestRun.status} at ${formatDate(latestRun.ran_at)}` : "No visibility run has completed yet.",
            latestRun ? `Latest run jobs: ${jobCounts}` : null,
            topPrompts.length ? `Strong prompts: ${topPrompts.join(" | ")}` : null,
            weakPrompts.length ? `Weak prompts to inspect: ${weakPrompts.join(" | ")}` : null,
            trackedCompetitors.length ? `Tracked competitor signals: ${trackedCompetitors.join(" | ")}` : "No tracked competitor mentions found yet.",
            failedExamples.length ? `Recent failed scrape examples: ${failedExamples.join(" | ")}` : null,
        ],
    }
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
