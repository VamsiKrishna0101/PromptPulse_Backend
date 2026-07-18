import { Queue } from "bullmq"
import { getRedisConnectionOptions } from "../lib/redis"

export type ScrapeQueueJob = {
    scrape_job_id: string
}

export const SCRAPE_QUEUE_NAME = "ai-visibility-scrape"

let scrapeQueue: Queue<ScrapeQueueJob, void, "scrape"> | null = null

export function getScrapeQueue() {
    if (scrapeQueue) return scrapeQueue

    scrapeQueue = new Queue<ScrapeQueueJob, void, "scrape">(SCRAPE_QUEUE_NAME, {
        connection: getRedisConnectionOptions(),
        defaultJobOptions: {
            attempts: Number(process.env.SCRAPE_QUEUE_ATTEMPTS ?? 3),
            backoff: {
                type: "exponential",
                delay: Number(process.env.SCRAPE_QUEUE_RETRY_DELAY_MS ?? 60000)
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

    scrapeQueue.on("error", error => {
        console.error(`Scrape queue Redis error: ${error.message}`)
    })

    return scrapeQueue
}

export async function enqueueScrapeJob(scrape_job_id: string, delay = 0) {
    try {
        return await getScrapeQueue().add(
            "scrape",
            { scrape_job_id },
            {
                jobId: scrape_job_id,
                delay
            }
        )
    } catch (error) {
        throw new Error(`Could not enqueue scrape job. Is Redis running at ${process.env.REDIS_URL ?? "redis://127.0.0.1:6379"}? ${error instanceof Error ? error.message : ""}`)
    }
}

export async function closeScrapeQueue() {
    if (!scrapeQueue) return
    await scrapeQueue.close()
    scrapeQueue = null
}
