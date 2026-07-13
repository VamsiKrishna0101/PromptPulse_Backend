import { Engine, Prisma, ScrapeJobStatus, VisibilityRunStatus } from "@prisma/client"
import prisma from "../../lib/prisma"
import { enqueueScrapeJob } from "../../queues/scrape_queue"

const DEFAULT_ENGINES: Engine[] = [
    Engine.CHATGPT,
    Engine.GEMINI,
    Engine.PERPLEXITY,
    Engine.GOOGLE_AI_OVERVIEW,
    Engine.GOOGLE_AI_MODE
]

export async function enqueueProjectRun(input: {
    project_id: string
    prompt_ids?: string[]
    engines?: Engine[]
    scheduled_for?: Date
    profile?: string
}) {
    const engines = input.engines?.length ? input.engines : DEFAULT_ENGINES
    const prompts = await prisma.prompt.findMany({
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
    const spacingMs = Number(process.env.SCRAPE_QUEUE_SPACING_MS ?? 180000)

    await Promise.all(jobs.map((job, index) => enqueueScrapeJob(job.id, baseDelayMs + index * spacingMs)))

    return {
        run,
        jobs
    }
}

export async function enqueueDailyRuns() {
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
    const spacingMs = Number(process.env.PROJECT_DAILY_QUEUE_SPACING_MS ?? 900000)

    for (let index = 0; index < projects.length; index += 1) {
        const scheduled_for = new Date(Date.now() + index * spacingMs)
        results.push(await enqueueProjectRun({ project_id: projects[index].id, scheduled_for }))
    }

    return results
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
