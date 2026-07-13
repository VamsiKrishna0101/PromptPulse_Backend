import { Queue } from "bullmq"
import { getRedisConnectionOptions } from "../lib/redis"

export type ScrapeQueueJob = {
    scrape_job_id: string
}

export const SCRAPE_QUEUE_NAME = "ai-visibility-scrape"

export const scrapeQueue = new Queue<ScrapeQueueJob, void, "scrape">(SCRAPE_QUEUE_NAME, {
    connection: getRedisConnectionOptions(),
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 300000
        },
        removeOnComplete: {
            age: 86400,
            count: 1000
        },
        removeOnFail: {
            age: 604800,
            count: 5000
        }
    }
})

export async function enqueueScrapeJob(scrape_job_id: string, delay = 0) {
    return scrapeQueue.add(
        "scrape",
        { scrape_job_id },
        {
            jobId: scrape_job_id,
            delay
        }
    )
}

export async function closeScrapeQueue() {
    await scrapeQueue.close()
}
