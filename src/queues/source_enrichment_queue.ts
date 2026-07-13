import { Queue } from "bullmq"
import { getRedisConnectionOptions } from "../lib/redis"

export type SourceEnrichmentQueueJob = {
    source_id: string
}

export const SOURCE_ENRICHMENT_QUEUE_NAME = "ai-visibility-source-enrichment"

export const sourceEnrichmentQueue = new Queue<SourceEnrichmentQueueJob, void, "enrich-source">(SOURCE_ENRICHMENT_QUEUE_NAME, {
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

export async function enqueueSourceEnrichment(source_id: string, delay = 0) {
    return sourceEnrichmentQueue.add("enrich-source", { source_id }, {
        jobId: source_id,
        delay
    })
}

export async function closeSourceEnrichmentQueue() {
    await sourceEnrichmentQueue.close()
}
