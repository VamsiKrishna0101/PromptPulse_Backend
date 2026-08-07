import "dotenv/config"
import cron from "node-cron"
import { enqueueDailyRuns } from "../features/scraping/scrape_orchestration_service"
import { cleanupOldArticleContents } from "../features/scraping/article_cleanup_service"
import { isScrapingDisabled } from "../features/scraping/scrape_gate"

const expression = process.env.DAILY_SCRAPE_CRON ?? "0 0 * * *"
const timezone = process.env.DAILY_SCRAPE_TIMEZONE ?? "Asia/Kolkata"

cron.schedule(expression, async () => {
    if (isScrapingDisabled()) {
        console.log("Daily scrape scheduler skipped: scraping is disabled for all projects")
        return
    }
    try {
        const runs = await enqueueDailyRuns()
        console.log(`Daily scrape scheduler enqueued ${runs.length} project runs`)
        
        // Clean up full article text older than 24h
        await cleanupOldArticleContents()
    } catch (error) {
        console.error("Daily scrape scheduler failed", error)
    }
}, { timezone })

console.log(`Daily scrape scheduler active: ${expression} ${timezone}; scraping disabled=${isScrapingDisabled()}`)
