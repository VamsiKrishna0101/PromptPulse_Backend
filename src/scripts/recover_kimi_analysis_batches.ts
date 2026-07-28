import "../lib/env"
import {
    BrightDataBatchItemStatus,
    BrightDataBatchStatus,
    ScrapeJobStatus,
    VisibilityRunStatus,
} from "@prisma/client"

import prisma from "../lib/prisma"

const KIMI_CONFIGURATION_ERROR = "Kimi analysis is required but the Bedrock gateway is not configured"

async function main() {
    const batchIds = (process.env.BRIGHT_DATA_RECOVERY_BATCH_IDS ?? "")
        .split(",")
        .map(value => value.trim())
        .filter(Boolean)

    if (batchIds.length === 0) {
        throw new Error("BRIGHT_DATA_RECOVERY_BATCH_IDS is required.")
    }

    const batches = await prisma.brightDataBatch.findMany({
        where: { id: { in: batchIds } },
        include: {
            items: {
                select: {
                    scrape_job_id: true,
                    error_reason: true,
                    scrape_job: { select: { run_id: true, error_reason: true } },
                },
            },
        },
    })

    const foundIds = new Set(batches.map(batch => batch.id))
    const missingIds = batchIds.filter(id => !foundIds.has(id))
    if (missingIds.length > 0) {
        throw new Error(`Unknown Bright Data batch IDs: ${missingIds.join(", ")}`)
    }

    for (const batch of batches) {
        if (!batch.snapshot_id) {
            throw new Error(`Batch ${batch.id} has no snapshot and cannot be recovered without retriggering.`)
        }

        const unrelatedFailure = batch.items.find(item => {
            const reason = item.error_reason ?? item.scrape_job.error_reason ?? ""
            return !reason.includes(KIMI_CONFIGURATION_ERROR)
        })
        if (unrelatedFailure) {
            throw new Error(`Batch ${batch.id} contains a non-Kimi failure and was not reset.`)
        }
    }

    const jobIds = batches.flatMap(batch => batch.items.map(item => item.scrape_job_id))
    const runIds = [...new Set(batches.flatMap(batch => batch.items.map(item => item.scrape_job.run_id)))]
    const now = new Date()

    await prisma.$transaction([
        prisma.brightDataBatch.updateMany({
            where: { id: { in: batchIds } },
            data: {
                status: BrightDataBatchStatus.RUNNING,
                completed_count: 0,
                failed_count: 0,
                error_reason: null,
                next_poll_at: now,
                completed_at: null,
            },
        }),
        prisma.brightDataBatchItem.updateMany({
            where: { batch_id: { in: batchIds } },
            data: {
                status: BrightDataBatchItemStatus.QUEUED,
                error_reason: null,
            },
        }),
        prisma.scrapeJob.updateMany({
            where: { id: { in: jobIds } },
            data: {
                status: ScrapeJobStatus.RUNNING,
                error_reason: null,
                completed_at: null,
            },
        }),
        prisma.run.updateMany({
            where: { id: { in: runIds } },
            data: {
                status: VisibilityRunStatus.RUNNING,
                error_reason: null,
                completed_at: null,
            },
        }),
    ])

    console.log(JSON.stringify({
        ok: true,
        recovered_batches: batchIds,
        reused_snapshots: batches.map(batch => batch.snapshot_id),
        reset_jobs: jobIds.length,
        reset_runs: runIds.length,
        next_step: "Run brightdata:poll after the poll runtime has a Bedrock gateway credential.",
    }, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
