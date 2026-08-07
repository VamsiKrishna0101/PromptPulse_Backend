import "dotenv/config"
import { PromptStatus, ScrapeJobStatus, VisibilityRunStatus } from "@prisma/client"
import prisma from "../lib/prisma"

function requestedEmails() {
    return (process.env.RESTRICT_SCHEDULE_EMAILS ?? "")
        .split(",")
        .map(email => email.trim().toLowerCase())
        .filter(Boolean)
}

async function eligibleProjects() {
    return prisma.project.findMany({
        where: {
            prompts: {
                some: {
                    is_active: true,
                    status: PromptStatus.ACTIVE,
                },
            },
        },
        select: {
            id: true,
            brand_name: true,
            user: { select: { email: true } },
            _count: {
                select: {
                    prompts: {
                        where: {
                            is_active: true,
                            status: PromptStatus.ACTIVE,
                        },
                    },
                },
            },
        },
        orderBy: { brand_name: "asc" },
    })
}

async function main() {
    const emails = requestedEmails()
    const apply = process.argv.includes("--apply")

    if (emails.length === 0) {
        throw new Error("Set RESTRICT_SCHEDULE_EMAILS to a comma-separated allowlist.")
    }

    const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: {
            id: true,
            email: true,
            is_verified: true,
            projects: {
                select: {
                    id: true,
                    brand_name: true,
                    brand_url: true,
                    prompts: {
                        select: { status: true, is_active: true },
                    },
                },
                orderBy: { created_at: "asc" },
            },
        },
        orderBy: { email: "asc" },
    })

    const foundEmails = new Set(users.map(user => user.email.toLowerCase()))
    const missingEmails = emails.filter(email => !foundEmails.has(email))
    if (missingEmails.length > 0) {
        throw new Error(`No user found for: ${missingEmails.join(", ")}`)
    }

    const targetProjectIds = users.flatMap(user => user.projects.map(project => project.id))
    if (targetProjectIds.length === 0) {
        throw new Error("The allowed users do not own any projects.")
    }

    const before = {
        allowed_users: users.map(user => ({
            email: user.email,
            is_verified: user.is_verified,
            projects: user.projects.map(project => ({
                id: project.id,
                brand_name: project.brand_name,
                brand_url: project.brand_url,
                total_prompts: project.prompts.length,
                active_prompts: project.prompts.filter(
                    prompt => prompt.is_active && prompt.status === PromptStatus.ACTIVE,
                ).length,
                eligible_inactive_prompts: project.prompts.filter(
                    prompt => ![PromptStatus.ARCHIVED, PromptStatus.DELETED].includes(prompt.status),
                ).length,
            })),
        })),
        active_prompts_outside_allowlist: await prisma.prompt.count({
            where: {
                project_id: { notIn: targetProjectIds },
                is_active: true,
                status: PromptStatus.ACTIVE,
            },
        }),
        queued_jobs_outside_allowlist: await prisma.scrapeJob.count({
            where: {
                project_id: { notIn: targetProjectIds },
                status: ScrapeJobStatus.QUEUED,
            },
        }),
        running_jobs_outside_allowlist: await prisma.scrapeJob.count({
            where: {
                project_id: { notIn: targetProjectIds },
                status: ScrapeJobStatus.RUNNING,
            },
        }),
        eligible_projects: await eligibleProjects(),
    }

    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", before }, null, 2))
    if (!apply) return

    const now = new Date()
    const result = await prisma.$transaction(async tx => {
        const disabledPrompts = await tx.prompt.updateMany({
            where: {
                project_id: { notIn: targetProjectIds },
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

        const stoppedQueuedJobs = await tx.scrapeJob.updateMany({
            where: {
                project_id: { notIn: targetProjectIds },
                status: ScrapeJobStatus.QUEUED,
            },
            data: {
                status: ScrapeJobStatus.FAILED,
                completed_at: now,
                error_reason: "Stopped by administrator: project excluded from scheduled monitoring.",
            },
        })

        const stoppedQueuedRuns = await tx.run.updateMany({
            where: {
                project_id: { notIn: targetProjectIds },
                status: VisibilityRunStatus.QUEUED,
            },
            data: {
                status: VisibilityRunStatus.FAILED,
                completed_at: now,
                error_reason: "Stopped by administrator: project excluded from scheduled monitoring.",
            },
        })

        return {
            disabled_prompts: disabledPrompts.count,
            preserved_allowed_prompt_states: true,
            stopped_queued_jobs: stoppedQueuedJobs.count,
            stopped_queued_runs: stoppedQueuedRuns.count,
        }
    })

    const after = {
        active_prompts_outside_allowlist: await prisma.prompt.count({
            where: {
                project_id: { notIn: targetProjectIds },
                is_active: true,
                status: PromptStatus.ACTIVE,
            },
        }),
        queued_jobs_outside_allowlist: await prisma.scrapeJob.count({
            where: {
                project_id: { notIn: targetProjectIds },
                status: ScrapeJobStatus.QUEUED,
            },
        }),
        eligible_projects: await eligibleProjects(),
    }

    console.log(JSON.stringify({ result, after }, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
