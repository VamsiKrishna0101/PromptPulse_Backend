import "dotenv/config"
import { Queue } from "bullmq"
import prisma from "../lib/prisma"
import { getRedisConnectionOptions } from "../lib/redis"
import { enqueueProjectRun } from "../features/scraping/scrape_orchestration_service"
import type { ScrapeQueueJob } from "../queues/scrape_queue"

const SCRAPE_QUEUE_NAME = "ai-visibility-scrape"

async function main() {
    const project = await prisma.project.findFirst({
        orderBy: { created_at: "desc" },
        select: { id: true, brand_name: true },
    })

    if (!project) {
        throw new Error("No project found to rerun.")
    }

    const queue = new Queue<ScrapeQueueJob, void, "scrape">(SCRAPE_QUEUE_NAME, {
        connection: getRedisConnectionOptions(),
    })

    try {
        const staleJobs = await queue.getJobs(["waiting", "delayed", "failed"], 0, 1000, false)
        await Promise.all(staleJobs.map(job => job.remove()))

        const result = await enqueueProjectRun({ project_id: project.id })
        const counts = await queue.getJobCounts("waiting", "delayed", "active", "completed", "failed")

        console.log(JSON.stringify({
            project,
            removed_stale_queue_jobs: staleJobs.length,
            created_run_id: result.run.id,
            created_scrape_jobs: result.jobs.length,
            queue_counts: counts,
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
