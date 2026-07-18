import "../lib/env"
import prisma from "../lib/prisma"
import { enqueueDailyRuns } from "../features/scraping/scrape_orchestration_service"
import { triggerQueuedBrightDataBatches } from "../features/scraping/brightdata_batch_service"

async function main() {
    const runs = await enqueueDailyRuns({ enqueue_jobs: false })
    const batches = await triggerQueuedBrightDataBatches()

    console.log(JSON.stringify({
        ok: true,
        created_project_runs: runs.length,
        queued_scrape_jobs: runs.reduce((sum, run) => sum + run.jobs.length, 0),
        batch_trigger: batches,
        next_step: "Run brightdata:poll periodically until pending batches complete.",
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
