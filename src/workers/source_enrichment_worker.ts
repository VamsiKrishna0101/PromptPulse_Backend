import "dotenv/config"
import { Worker } from "bullmq"
import { getRedisConnectionOptions } from "../lib/redis"
import prisma from "../lib/prisma"
import { SOURCE_ENRICHMENT_QUEUE_NAME, type SourceEnrichmentQueueJob } from "../queues/source_enrichment_queue"
import { enrichSource } from "../features/sources/source_enrichment_service"

const worker = new Worker<SourceEnrichmentQueueJob, void, "enrich-source">(
    SOURCE_ENRICHMENT_QUEUE_NAME,
    async job => {
        await enrichSource(job.data.source_id)
    },
    {
        connection: getRedisConnectionOptions(),
        concurrency: Number(process.env.SOURCE_ENRICHMENT_CONCURRENCY ?? 3)
    }
)

worker.on("completed", job => {
    console.log(`Source enrichment completed: ${job.id}`)
})

worker.on("failed", (job, error) => {
    console.error(`Source enrichment failed: ${job?.id}`, error)
})

process.on("SIGINT", async () => {
    await worker.close()
    await prisma.$disconnect()
    process.exit(0)
})

process.on("SIGTERM", async () => {
    await worker.close()
    await prisma.$disconnect()
    process.exit(0)
})
