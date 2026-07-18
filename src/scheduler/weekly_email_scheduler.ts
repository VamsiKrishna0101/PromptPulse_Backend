import "../lib/env"
import cron from "node-cron"
import { sendWeeklyEmailReports } from "../features/email/weekly_report_service"

const expression = process.env.WEEKLY_EMAIL_REPORT_CRON ?? "0 9 * * 1"
const timezone = process.env.WEEKLY_EMAIL_REPORT_TIMEZONE ?? "Asia/Kolkata"

cron.schedule(expression, async () => {
    try {
        const result = await sendWeeklyEmailReports()
        console.log(`Weekly email scheduler finished: ${result.reports.length} project reports checked`)
    } catch (error) {
        console.error("Weekly email scheduler failed", error)
    }
}, { timezone })

console.log(`Weekly email scheduler active: ${expression} ${timezone}`)
