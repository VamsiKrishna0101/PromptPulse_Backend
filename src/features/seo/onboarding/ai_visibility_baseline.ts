import { Engine, PromptSource, PromptStatus } from "@prisma/client"
import prisma from "../../../lib/prisma"
import { enqueueProjectRun } from "../../scraping/scrape_orchestration_service"
import { getProjectEngines } from "../../project_engines/project_engines_service"
import { getPromptRunCreditCost } from "../../payments/credits_service"
import { getCreditBalance } from "../../credits/credits_service"

function clean(value: string) {
    return value.trim().replace(/\s+/g, " ").slice(0, 120)
}

export function buildVisibilityPrompts(input: { brandName: string; location: string; services: string[]; maxPrompts: number }) {
    const services = input.services.map(clean).filter(Boolean).slice(0, 3)
    const location = clean(input.location)
    const prompts = services.flatMap(service => [
        `What are the best ${service} providers in ${location}?`,
        `Which companies offer ${service} in ${location}?`,
        `How should I choose a ${service} provider in ${location}?`,
    ])
    if (!prompts.length) {
        prompts.push(
            `What does ${clean(input.brandName)} offer in ${location}?`,
            `Which companies are recommended for services like ${clean(input.brandName)} in ${location}?`,
            `What should a buyer compare before choosing a provider in ${location}?`,
        )
    }
    return [...new Set(prompts)].slice(0, Math.min(Math.max(input.maxPrompts, 1), 8))
}

export async function startAiVisibilityBaseline(input: {
    onboardingRunId: string
    projectId: string
    actorUserId: string
    brandName: string
    location: string
    services: string[]
    maxPrompts: number
}) {
    const texts = buildVisibilityPrompts(input)
    const engines = (await getProjectEngines(input.projectId)).filter(engine => engine !== Engine.GOOGLE_AI_OVERVIEW).slice(0, 3)
    if (!engines.length) throw new Error("No AI visibility engines are configured for this project")
    const unitCost = await getPromptRunCreditCost(input.actorUserId)
    const estimatedCredits = texts.length * engines.length * unitCost
    const balance = await getCreditBalance(input.actorUserId)
    if (balance.remaining < estimatedCredits) throw Object.assign(new Error(`AI visibility baseline needs approximately ${estimatedCredits} credits`), { status: 402 })

    const prompts = []
    for (const text of texts) {
        prompts.push(await prisma.prompt.create({
            data: {
                text, topic: "SEO onboarding AI visibility", type: "onboarding_visibility", project_id: input.projectId,
                tags: [`seo-onboarding:${input.onboardingRunId}`], source: PromptSource.GENERATED,
                status: PromptStatus.ACTIVE, is_active: true,
            },
            select: { id: true, text: true },
        }))
    }
    try {
        const queued = await enqueueProjectRun({ project_id: input.projectId, prompt_ids: prompts.map(prompt => prompt.id), engines, profile: "seo-onboarding" })
        return { visibilityRunId: queued.run.id, prompts, engines, estimatedCredits }
    } catch (error) {
        await prisma.prompt.updateMany({ where: { id: { in: prompts.map(prompt => prompt.id) } }, data: { status: PromptStatus.ARCHIVED, is_active: false } })
        throw error
    }
}

export async function summarizeAiVisibility(visibilityRunId: string) {
    const jobs = await prisma.scrapeJob.findMany({
        where: { run_id: visibilityRunId },
        include: { prompt: { select: { id: true, text: true } }, chat: { select: { brand_mentioned: true, brand_position: true, sentiment_score: true, sources: { select: { domain: true, is_cited: true } } } } },
    })
    const completed = jobs.filter(job => job.status === "SUCCESS" && job.chat)
    const mentions = completed.filter(job => job.chat?.brand_mentioned)
    const citedDomains = [...new Set(completed.flatMap(job => job.chat?.sources.filter(source => source.is_cited).map(source => source.domain) ?? []))]
    return {
        total_jobs: jobs.length,
        successful_jobs: completed.length,
        brand_mentions: mentions.length,
        visibility_percent: completed.length ? Math.round((mentions.length / completed.length) * 100) : null,
        average_position: mentions.length ? mentions.reduce((sum, job) => sum + (job.chat?.brand_position ?? 0), 0) / mentions.length : null,
        cited_domains: citedDomains.slice(0, 30),
        observations: completed.map(job => ({ prompt: job.prompt.text, mentioned: job.chat?.brand_mentioned ?? false, position: job.chat?.brand_position ?? null })).slice(0, 50),
    }
}

export async function archiveOnboardingPrompts(onboardingRunId: string) {
    await prisma.prompt.updateMany({
        where: { tags: { has: `seo-onboarding:${onboardingRunId}` } },
        data: { status: PromptStatus.ARCHIVED, is_active: false },
    })
}
