import "../lib/env"
import { Queue } from "bullmq"
import prisma from "../lib/prisma"
import { enqueueProjectRun } from "../features/scraping/scrape_orchestration_service"
import { SCRAPE_QUEUE_NAME, closeScrapeQueue } from "../queues/scrape_queue"
import { SOURCE_ENRICHMENT_QUEUE_NAME, closeSourceEnrichmentQueue } from "../queues/source_enrichment_queue"
import { getRedisConnectionOptions } from "../lib/redis"

async function clearQueue(name: string) {
    const queue = new Queue(name, { connection: getRedisConnectionOptions() })
    try {
        await queue.pause()
        await queue.obliterate({ force: true })
    } finally {
        await queue.close()
    }
}

async function clearScrapeDerivedData() {
    return prisma.$transaction(async tx => {
        const before = {
            competitors: await tx.competitor.count(),
            runs: await tx.run.count(),
            scrapeJobs: await tx.scrapeJob.count(),
            chats: await tx.chat.count(),
            brandMentions: await tx.brandMention.count(),
            sources: await tx.source.count(),
            sourceUrlContent: await tx.sourceUrlContent.count(),
            aiReports: await tx.aIReport.count(),
            contentBriefs: await tx.contentBrief.count(),
            weeklyEmailReports: await tx.weeklyEmailReport.count(),
            saraConversations: await tx.saraConversation.count(),
        }

        await tx.weeklyEmailReport.deleteMany()
        await tx.contentBrief.deleteMany()
        await tx.aIReport.deleteMany()
        await tx.saraConversation.deleteMany()
        await tx.scrapeJob.deleteMany()
        await tx.source.deleteMany()
        await tx.sourceUrlContent.deleteMany()
        await tx.brandMention.deleteMany()
        await tx.chat.deleteMany()
        await tx.run.deleteMany()
        await tx.competitor.deleteMany()

        return before
    }, { timeout: 30000 })
}

async function enqueueFreshProjectRuns() {
    const projects = await prisma.project.findMany({
        where: {
            prompts: {
                some: {
                    is_active: true,
                    status: "ACTIVE",
                },
            },
        },
        select: {
            id: true,
            brand_name: true,
            _count: {
                select: {
                    prompts: {
                        where: {
                            is_active: true,
                            status: "ACTIVE",
                        },
                    },
                },
            },
        },
        orderBy: { created_at: "asc" },
    })

    const results = []
    for (const project of projects) {
        const result = await enqueueProjectRun({ project_id: project.id })
        results.push({
            project_id: project.id,
            brand_name: project.brand_name,
            active_prompts: project._count.prompts,
            run_id: result.run.id,
            queued_jobs: result.jobs.length,
        })
    }

    return results
}

async function main() {
    await Promise.all([
        clearQueue(SCRAPE_QUEUE_NAME),
        clearQueue(SOURCE_ENRICHMENT_QUEUE_NAME),
    ])

    const deletedCounts = await clearScrapeDerivedData()
    const enqueuedRuns = await enqueueFreshProjectRuns()

    console.log(JSON.stringify({
        preserved: [
            "User",
            "Subscription",
            "PlanUsage",
            "CreditLedgerEntry",
            "Project",
            "Prompt",
            "Topic",
            "GeoPromptVariant",
            "WebAnalytics*",
            "HelpCenter",
            "BookDemo",
        ],
        cleared_redis_queues: [SCRAPE_QUEUE_NAME, SOURCE_ENRICHMENT_QUEUE_NAME],
        deleted_counts: deletedCounts,
        enqueued_runs: enqueuedRuns,
        total_queued_jobs: enqueuedRuns.reduce((sum, run) => sum + run.queued_jobs, 0),
    }, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await closeScrapeQueue().catch(() => undefined)
        await closeSourceEnrichmentQueue().catch(() => undefined)
        await prisma.$disconnect()
    })
