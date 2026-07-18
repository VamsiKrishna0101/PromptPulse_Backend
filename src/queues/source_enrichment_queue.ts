import { Queue } from "bullmq"
import { getRedisConnectionOptions } from "../lib/redis"

export type SourceEnrichmentQueueJob = {
    source_id: string
}

export const SOURCE_ENRICHMENT_QUEUE_NAME = "ai-visibility-source-enrichment"

let sourceEnrichmentQueue: Queue<SourceEnrichmentQueueJob, void, "enrich-source"> | null = null

export function getSourceEnrichmentQueue() {
    if (sourceEnrichmentQueue) return sourceEnrichmentQueue

    sourceEnrichmentQueue = new Queue<SourceEnrichmentQueueJob, void, "enrich-source">(SOURCE_ENRICHMENT_QUEUE_NAME, {
        connection: getRedisConnectionOptions(),
        defaultJobOptions: {
            attempts: 2,
            backoff: {
                type: "exponential",
                delay: 60000
            },
            removeOnComplete: {
                age: 86400,
                count: 2000
            },
            removeOnFail: {
                age: 604800,
                count: 5000
            }
        }
    })

    sourceEnrichmentQueue.on("error", error => {
        console.error(`Source enrichment queue Redis error: ${error.message}`)
    })

    return sourceEnrichmentQueue
}

export async function enqueueSourceEnrichment(source_id: string, delay = 0) {
    try {
        return await getSourceEnrichmentQueue().add("enrich-source", { source_id }, {
            jobId: source_id,
            delay
        })
    } catch (error) {
        throw new Error(`Could not enqueue source enrichment. Is Redis running at ${process.env.REDIS_URL ?? "redis://127.0.0.1:6379"}? ${error instanceof Error ? error.message : ""}`)
    }
}

export async function closeSourceEnrichmentQueue() {
    if (!sourceEnrichmentQueue) return
    await sourceEnrichmentQueue.close()
    sourceEnrichmentQueue = null
}
