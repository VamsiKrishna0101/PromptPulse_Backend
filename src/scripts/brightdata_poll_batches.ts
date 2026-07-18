import "../lib/env"
import prisma from "../lib/prisma"
import { pollBrightDataBatches } from "../features/scraping/brightdata_batch_service"

async function main() {
    const limit = process.env.BRIGHT_DATA_POLLER_BATCH_LIMIT
        ? Number(process.env.BRIGHT_DATA_POLLER_BATCH_LIMIT)
        : undefined

    const result = await pollBrightDataBatches({ limit })

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
