import { Engine, Prisma, ScrapeJobStatus, VisibilityRunStatus } from "@prisma/client"
import prisma from "../../lib/prisma"
import { enqueueScrapeJob } from "../../queues/scrape_queue"
import { getGeoCountryByName } from "../geo/countries"
import { canRunRefresh } from "../subscription/subscription_service"
import { getRefreshWindowStart } from "../refresh/refresh_window"

const CORE_DEFAULT_ENGINES: Engine[] = [
    Engine.CHATGPT,
    Engine.GEMINI,
    Engine.PERPLEXITY,
    Engine.GOOGLE_AI_MODE
]

function getDefaultEngines(): Engine[] {
    if (process.env.BRIGHT_DATA_COPILOT_SCRAPER_ID?.trim()) {
        return [...CORE_DEFAULT_ENGINES, Engine.COPILOT]
    }

    return CORE_DEFAULT_ENGINES
}

export async function enqueueProjectRun(input: {
    project_id: string
    prompt_ids?: string[]
    engines?: Engine[]
    scheduled_for?: Date
    profile?: string
    enqueue_jobs?: boolean
}) {
    const engines = input.engines?.length ? input.engines : getDefaultEngines()
    const [project, prompts] = await Promise.all([
        prisma.project.findUniqueOrThrow({
            where: { id: input.project_id },
            select: { brand_location: true }
        }),
        prisma.prompt.findMany({
            where: {
                project_id: input.project_id,
                is_active: true,
                status: "ACTIVE",
                ...(input.prompt_ids?.length ? { id: { in: input.prompt_ids } } : {})
            },
            include: {
                geo_variants: {
                    where: { is_active: true }
                }
            },
            orderBy: { created_at: "asc" }
        })
    ])
    const projectCountry = getGeoCountryByName(project.brand_location)

    if (prompts.length === 0) {
        throw new Error("No active prompts found for this project")
    }

    const run = await prisma.run.create({
        data: {
            project_id: input.project_id,
            status: VisibilityRunStatus.QUEUED,
            scheduled_for: input.scheduled_for
        }
    })

    const rows: Prisma.ScrapeJobCreateManyInput[] = []

    for (const prompt of prompts) {
        for (const engine of engines) {
            // 1. Base Job (Global)
            rows.push({
                run_id: run.id,
                project_id: input.project_id,
                prompt_id: prompt.id,
                geo_country_code: projectCountry?.code,
                geo_country_name: projectCountry?.name,
                engine,
                status: ScrapeJobStatus.QUEUED,
                profile: input.profile,
                scheduled_for: input.scheduled_for
            })

            // 2. Geo Variant Jobs
            if (prompt.geo_enabled && prompt.geo_variants.length > 0) {
                for (const variant of prompt.geo_variants) {
                    rows.push({
                        run_id: run.id,
                        project_id: input.project_id,
                        prompt_id: prompt.id,
                        geo_variant_id: variant.id,
                        geo_country_code: variant.country_code,
                        geo_country_name: variant.country_name,
                        geo_city: variant.city,
                        engine,
                        status: ScrapeJobStatus.QUEUED,
                        profile: input.profile,
                        scheduled_for: input.scheduled_for
                    })
                }
            }
        }
    }

    await prisma.scrapeJob.createMany({ data: rows })

    const jobs = await prisma.scrapeJob.findMany({
        where: { run_id: run.id },
        orderBy: { created_at: "asc" }
    })

    const baseDelayMs = Math.max(0, input.scheduled_for ? input.scheduled_for.getTime() - Date.now() : 0)
    // Reduced from 180000 (3 min) to 45000 (45 sec) — safe with proxy rotation
    const spacingMs = Number(process.env.SCRAPE_QUEUE_SPACING_MS ?? 45000)

    if (input.enqueue_jobs !== false) {
        await Promise.all(jobs.map((job, index) => enqueueScrapeJob(job.id, baseDelayMs + index * spacingMs)))
    }

    return {
        run,
        jobs
    }
}

export async function enqueueDailyRuns(options: {
    enqueue_jobs?: boolean
} = {}) {
    const projects = await prisma.project.findMany({
        where: {
            prompts: {
                some: {
                    is_active: true,
                    status: "ACTIVE"
                }
            }
        },
        orderBy: { created_at: "asc" }
    })

    const results = []
    const spacingMs = options.enqueue_jobs === false
        ? 0
        : Number(process.env.PROJECT_DAILY_QUEUE_SPACING_MS ?? 900000)

    for (let index = 0; index < projects.length; index += 1) {
        const existingTodayRun = await prisma.run.findFirst({
            where: {
                project_id: projects[index].id,
                ran_at: { gte: getRefreshWindowStart() },
            },
            orderBy: { ran_at: "desc" },
        })

        if (existingTodayRun) {
            const retryResult = await requeueFailedJobsForRun(existingTodayRun.id)
            if (retryResult.jobs.length > 0) {
                results.push(retryResult)
            }
            continue
        }

        const refreshCheck = await canRunRefresh(projects[index].user_id, projects[index].id)
        if (!refreshCheck.allowed) {
            continue
        }

        const scheduled_for = new Date(Date.now() + index * spacingMs)
        results.push(await enqueueProjectRun({
            project_id: projects[index].id,
            scheduled_for,
            enqueue_jobs: options.enqueue_jobs,
        }))
    }

    return results
}

async function requeueFailedJobsForRun(run_id: string) {
    const failedJobs = await prisma.scrapeJob.findMany({
        where: {
            run_id,
            status: ScrapeJobStatus.FAILED,
            chat_id: null,
        },
        select: { id: true },
    })

    if (failedJobs.length === 0) {
        const run = await prisma.run.findUniqueOrThrow({ where: { id: run_id } })
        return { run, jobs: [] }
    }

    const jobIds = failedJobs.map(job => job.id)

    await prisma.$transaction([
        prisma.brightDataBatchItem.deleteMany({
            where: { scrape_job_id: { in: jobIds } },
        }),
        prisma.scrapeJob.updateMany({
            where: { id: { in: jobIds } },
            data: {
                status: ScrapeJobStatus.QUEUED,
                started_at: null,
                completed_at: null,
                error_reason: null,
                retry_count: { increment: 1 },
            },
        }),
        prisma.run.update({
            where: { id: run_id },
            data: {
                status: VisibilityRunStatus.QUEUED,
                completed_at: null,
                error_reason: null,
            },
        }),
    ])

    const [run, jobs] = await Promise.all([
        prisma.run.findUniqueOrThrow({ where: { id: run_id } }),
        prisma.scrapeJob.findMany({
            where: { id: { in: jobIds } },
            orderBy: { created_at: "asc" },
        }),
    ])

    return { run, jobs }
}

export async function getScrapeRun(run_id: string) {
    return prisma.run.findUnique({
        where: { id: run_id },
        include: {
            scrape_jobs: {
                include: {
                    prompt: true,
                    chat: {
                        include: {
                            sources: true,
                            brand_mentions: true
                        }
                    }
                },
                orderBy: { created_at: "asc" }
            }
        }
    })
}
