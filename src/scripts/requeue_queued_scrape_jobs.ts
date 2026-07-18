import "../lib/env"
import { Queue } from "bullmq"
import prisma from "../lib/prisma"
import { SCRAPE_QUEUE_NAME, enqueueScrapeJob, closeScrapeQueue } from "../queues/scrape_queue"
import { getRedisConnectionOptions } from "../lib/redis"

async function main() {
    const jobsToQueue = await prisma.scrapeJob.findMany({
        where: {
            status: {
                in: ["QUEUED", "FAILED", "RATE_LIMITED"],
            },
        },
        orderBy: {
            created_at: "asc",
        },
        select: {
            id: true,
            scheduled_for: true,
        },
    })

    const queue = new Queue(SCRAPE_QUEUE_NAME, { connection: getRedisConnectionOptions() })
    const staleJobs = [
        ...(await queue.getWaiting(0, -1)),
        ...(await queue.getDelayed(0, -1)),
        ...(await queue.getFailed(0, -1)),
    ]

    for (const job of staleJobs) {
        await job.remove().catch(() => undefined)
    }

    if (jobsToQueue.length > 0) {
        await prisma.scrapeJob.updateMany({
            where: {
                id: {
                    in: jobsToQueue.map(job => job.id),
                },
            },
            data: {
                status: "QUEUED",
                started_at: null,
                completed_at: null,
                error_reason: null,
            },
        })
    }

    const spacingMs = Number(process.env.SCRAPE_QUEUE_SPACING_MS ?? 30000)

    for (let index = 0; index < jobsToQueue.length; index += 1) {
        const job = jobsToQueue[index]
        const scheduledDelay = job.scheduled_for
            ? Math.max(0, job.scheduled_for.getTime() - Date.now())
            : 0

        await enqueueScrapeJob(job.id, scheduledDelay + index * spacingMs)
    }

    await queue.close()

    console.log(`Removed ${staleJobs.length} stale queue jobs`)
    console.log(`Requeued ${jobsToQueue.length} scrape jobs`)
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await closeScrapeQueue().catch(() => undefined)
        await prisma.$disconnect()
    })
