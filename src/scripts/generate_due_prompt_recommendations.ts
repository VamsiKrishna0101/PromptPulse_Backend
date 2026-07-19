import "dotenv/config"
import prisma from "../lib/prisma"
import { getEffectivePlanAccess } from "../features/subscription/entitlements"
import { discoverPromptCandidates } from "../features/prompts/prompt_discovery_service"

function recommendationSlot(now = new Date()) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const day = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    const half = now.getUTCDay() >= 5 ? "fri" : "tue"
    return `recommendation:${date.getUTCFullYear()}-w${String(week).padStart(2, "0")}-${half}`
}

async function main() {
    const runTag = recommendationSlot()
    const projects = await prisma.project.findMany({
        select: { id: true, user_id: true },
        orderBy: { created_at: "asc" },
    })
    const results: Array<Record<string, unknown>> = []

    for (const project of projects) {
        const access = await getEffectivePlanAccess(project.user_id)
        if (access.trial.expired) {
            results.push({ project_id: project.id, status: "skipped", reason: "trial_expired" })
            continue
        }

        const alreadyGenerated = await prisma.prompt.findFirst({
            where: { project_id: project.id, tags: { has: runTag } },
            select: { id: true },
        })
        if (alreadyGenerated) {
            results.push({ project_id: project.id, status: "skipped", reason: "already_generated" })
            continue
        }

        try {
            const result = await discoverPromptCandidates(project.id, { limit: 10, runTag })
            results.push({ project_id: project.id, status: "complete", ...result })
        } catch (error) {
            results.push({
                project_id: project.id,
                status: "failed",
                error: error instanceof Error ? error.message : "Unknown recommendation error",
            })
        }
    }

    console.log(JSON.stringify({ ok: true, run_tag: runTag, projects: results }, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => prisma.$disconnect())
