import "dotenv/config"
import { Queue } from "bullmq"
import prisma from "../lib/prisma"
import { getRedisConnectionOptions } from "../lib/redis"
import type { ScrapeQueueJob } from "../queues/scrape_queue"

const SCRAPE_QUEUE_NAME = "ai-visibility-scrape"

async function main() {
    const queue = new Queue<ScrapeQueueJob, void, "scrape">(SCRAPE_QUEUE_NAME, {
        connection: getRedisConnectionOptions(),
    })

    try {
        await queue.client.then(client => client.ping())

        const queueCounts = await queue.getJobCounts(
            "waiting",
            "delayed",
            "active",
            "completed",
            "failed",
            "paused"
        )

        const runs = await prisma.run.findMany({
            take: 5,
            orderBy: { ran_at: "desc" },
            include: {
                project: { select: { brand_name: true } },
                scrape_jobs: {
                    select: {
                        id: true,
                        engine: true,
                        status: true,
                        error_reason: true,
                        started_at: true,
                        completed_at: true,
                    },
                    orderBy: { created_at: "asc" },
                },
            },
        })

        console.log(JSON.stringify({
            redis: "connected",
            queue: SCRAPE_QUEUE_NAME,
            queueCounts,
            runs: runs.map(run => ({
                id: run.id,
                project: run.project.brand_name,
                status: run.status,
                ran_at: run.ran_at,
                started_at: run.started_at,
                completed_at: run.completed_at,
                jobs: run.scrape_jobs.map(job => ({
                    id: job.id,
                    engine: job.engine,
                    status: job.status,
                    started_at: job.started_at,
                    completed_at: job.completed_at,
                    error_reason: job.error_reason,
                })),
            })),
        }, null, 2))
    } finally {
        await queue.close()
        await prisma.$disconnect()
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
