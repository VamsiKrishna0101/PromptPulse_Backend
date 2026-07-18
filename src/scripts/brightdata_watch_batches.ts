import "../lib/env"
import prisma from "../lib/prisma"
import { BrightDataBatchStatus } from "@prisma/client"
import { pollBrightDataBatches } from "../features/scraping/brightdata_batch_service"

const intervalMs = Number(process.env.BRIGHT_DATA_WATCH_INTERVAL_MS ?? 30000)
const timeoutMs = Number(process.env.BRIGHT_DATA_WATCH_TIMEOUT_MS ?? 30 * 60 * 1000)

async function countPendingBatches() {
    return prisma.brightDataBatch.count({
        where: {
            status: { in: [BrightDataBatchStatus.TRIGGERED, BrightDataBatchStatus.RUNNING] },
        },
    })
}

async function main() {
    const startedAt = Date.now()

    while (Date.now() - startedAt < timeoutMs) {
        const pendingBefore = await countPendingBatches()
        if (pendingBefore === 0) {
            console.log(JSON.stringify({
                ok: true,
                done: true,
                message: "No pending BrightData batches.",
            }, null, 2))
            return
        }

        const result = await pollBrightDataBatches()
        const pendingAfter = await countPendingBatches()

        console.log(JSON.stringify({
            ok: true,
            elapsed_ms: Date.now() - startedAt,
            pending_before: pendingBefore,
            pending_after: pendingAfter,
            ...result,
        }, null, 2))

        if (pendingAfter === 0) return
        await new Promise(resolve => setTimeout(resolve, intervalMs))
    }

    throw new Error(`Timed out waiting for BrightData batches after ${timeoutMs}ms.`)
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
