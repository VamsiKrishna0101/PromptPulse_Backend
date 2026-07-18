import "../lib/env"
import prisma from "../lib/prisma"
import { triggerQueuedBrightDataBatches } from "../features/scraping/brightdata_batch_service"

async function main() {
    const limit = process.env.BRIGHT_DATA_BATCH_TRIGGER_LIMIT
        ? Number(process.env.BRIGHT_DATA_BATCH_TRIGGER_LIMIT)
        : undefined
    const batchSize = process.env.BRIGHT_DATA_BATCH_SIZE
        ? Number(process.env.BRIGHT_DATA_BATCH_SIZE)
        : undefined

    const result = await triggerQueuedBrightDataBatches({
        limit,
        batch_size: batchSize,
    })

    console.log(JSON.stringify({
        ok: true,
        ...result,
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
