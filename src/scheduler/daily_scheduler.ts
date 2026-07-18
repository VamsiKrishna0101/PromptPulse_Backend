import "dotenv/config"
import cron from "node-cron"
import { enqueueDailyRuns } from "../features/scraping/scrape_orchestration_service"

const expression = process.env.DAILY_SCRAPE_CRON ?? "0 0 * * *"
const timezone = process.env.DAILY_SCRAPE_TIMEZONE ?? "Asia/Kolkata"

cron.schedule(expression, async () => {
    try {
        const runs = await enqueueDailyRuns()
        console.log(`Daily scrape scheduler enqueued ${runs.length} project runs`)
    } catch (error) {
        console.error("Daily scrape scheduler failed", error)
    }
}, { timezone })

console.log(`Daily scrape scheduler active: ${expression} ${timezone}`)
