import "dotenv/config"
import { PromptStatus, ScrapeJobStatus } from "@prisma/client"
import prisma from "../lib/prisma"

async function main() {
    console.log("--- Stopping and disabling all running projects, prompts, and jobs ---")
    console.log("ScrapeJobStatus enum values:", ScrapeJobStatus)

    // 1. Deactivate all prompts across all projects
    const updatedPrompts = await prisma.prompt.updateMany({
        where: {
            OR: [
                { is_active: true },
                { status: PromptStatus.ACTIVE },
            ],
        },
        data: {
            is_active: false,
            status: PromptStatus.INACTIVE,
        },
    })
    console.log(`Deactivated ${updatedPrompts.count} active prompts across all projects.`)

    // 2. Check for scrape jobs
    const activeStatuses = Object.values(ScrapeJobStatus).filter(
        s => s !== ScrapeJobStatus.COMPLETED && s !== ScrapeJobStatus.FAILED
    )
    console.log("Active statuses to cancel:", activeStatuses)

    const cancelledJobs = await prisma.scrapeJob.updateMany({
        where: {
            status: { in: activeStatuses },
        },
        data: {
            status: ScrapeJobStatus.FAILED,
            error_reason: "Stopped by administrator: all projects disabled.",
        },
    })
    console.log(`Cancelled/Failed ${cancelledJobs.count} active scrape jobs.`)

    // 3. Summarize projects
    const projects = await prisma.project.findMany({
        select: {
            id: true,
            brand_name: true,
            user: { select: { email: true } },
            _count: { select: { prompts: true } },
        },
    })
    console.log(`\nAll ${projects.length} projects are now disabled:`)
    for (const p of projects) {
        console.log(` - Project "${p.brand_name}" (${p.user.email}): ${p._count.prompts} prompts inactive`)
    }
}

main()
    .catch((err) => {
        console.error("Error disabling projects:", err)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
