import "../lib/env"
import prisma from "../lib/prisma"
import { sendWeeklyEmailReports } from "../features/email/weekly_report_service"

async function main() {
    const targetEmail = process.env.WEEKLY_REPORT_TARGET_EMAIL?.trim()
    const force = process.env.WEEKLY_REPORT_FORCE === "true"
    const result = await sendWeeklyEmailReports({ targetEmail, force })
    console.log(JSON.stringify(result, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
