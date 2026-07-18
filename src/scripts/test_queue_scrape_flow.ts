import "../lib/env"
import { AccountType, Engine, Plan, UserRole, ScrapeJobStatus } from "@prisma/client"
import { Queue } from "bullmq"
import prisma from "../lib/prisma"
import { getRedisConnectionOptions } from "../lib/redis"
import { createPrompt, createTopic } from "../features/prompts/prompt_service"
import { enqueueProjectRun } from "../features/scraping/scrape_orchestration_service"
import { closeScrapeQueue, SCRAPE_QUEUE_NAME, type ScrapeQueueJob } from "../queues/scrape_queue"

const ENGINE_ALIASES: Record<string, Engine> = {
    chatgpt: Engine.CHATGPT,
    gpt: Engine.CHATGPT,
    gemini: Engine.GEMINI,
    perplexity: Engine.PERPLEXITY,
    google_ai_overview: Engine.GOOGLE_AI_OVERVIEW,
    google_ai_mode: Engine.GOOGLE_AI_MODE,
    google: Engine.GOOGLE_AI_MODE,
    copilot: Engine.COPILOT,
    bing: Engine.COPILOT,
}

const SCRAPER_ENV_BY_ENGINE: Record<Engine, string> = {
    [Engine.CHATGPT]: "BRIGHT_DATA_CHATGPT_SCRAPER_ID",
    [Engine.GEMINI]: "BRIGHT_DATA_GEMINI_SCRAPER_ID",
    [Engine.PERPLEXITY]: "BRIGHT_DATA_PERPLEXITY_SCRAPER_ID",
    [Engine.GOOGLE_AI_OVERVIEW]: "BRIGHT_DATA_GOOGLE_AI_OVERVIEW_SCRAPER_ID",
    [Engine.GOOGLE_AI_MODE]: "BRIGHT_DATA_GOOGLE_AI_MODE_SCRAPER_ID",
    [Engine.COPILOT]: "BRIGHT_DATA_COPILOT_SCRAPER_ID",
}

function parseEngines() {
    const raw = process.env.QUEUE_FLOW_TEST_ENGINES?.trim()
    if (!raw) return undefined

    const engines = raw
        .split(",")
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
        .map(value => {
            const engine = ENGINE_ALIASES[value]
            if (!engine) {
                throw new Error(`Unknown engine "${value}". Use chatgpt, gemini, perplexity, google_ai_overview, google_ai_mode, copilot.`)
            }
            return engine
        })

    return [...new Set(engines)]
}

function assertBrightDataEnv(engines: Engine[] | undefined) {
    const missing = []
    if (!process.env.BRIGHT_DATA_API_KEY?.trim()) missing.push("BRIGHT_DATA_API_KEY")

    for (const engine of engines ?? Object.values(Engine)) {
        const envName = SCRAPER_ENV_BY_ENGINE[engine]
        if (!process.env[envName]?.trim()) missing.push(envName)
    }

    if (missing.length) {
        throw new Error(`Missing BrightData env values: ${missing.join(", ")}`)
    }
}

async function ensureTestProject() {
    const email = process.env.QUEUE_FLOW_TEST_EMAIL?.trim() || "queue-flow-test@promptpulse.local"
    const brandName = process.env.QUEUE_FLOW_TEST_BRAND?.trim() || "PromptPulse Queue Flow Test"
    const brandUrl = process.env.QUEUE_FLOW_TEST_BRAND_URL?.trim() || "https://promptpulse.online"
    const brandLocation = process.env.QUEUE_FLOW_TEST_GEO_NAME?.trim() || "United States"

    const user = await prisma.user.upsert({
        where: { email },
        create: {
            email,
            password: "local-queue-flow-test-only",
            is_verified: true,
            account_type: AccountType.SINGLE,
            role: UserRole.ADMIN,
            plan: Plan.PRO,
        },
        update: {
            is_verified: true,
            plan: Plan.PRO,
        },
    })

    const project = await prisma.project.upsert({
        where: { brand_name: brandName },
        create: {
            brand_name: brandName,
            brand_url: brandUrl,
            brand_location: brandLocation,
            user_id: user.id,
        },
        update: {
            brand_url: brandUrl,
            brand_location: brandLocation,
            user_id: user.id,
        },
    })

    return { user, project }
}

async function ensureTestPrompt(projectId: string, topic: string, text: string) {
    const normalizedText = text.trim().replace(/\s+/g, " ")
    const normalizedTopic = topic.trim().replace(/\s+/g, " ")

    const existing = await prisma.prompt.findFirst({
        where: {
            project_id: projectId,
            text: normalizedText,
            topic: normalizedTopic,
            status: "ACTIVE",
            is_active: true,
        },
        orderBy: { created_at: "desc" },
        select: {
            id: true,
            text: true,
            topic: true,
        },
    })

    if (existing) return existing

    return createPrompt({
        project_id: projectId,
        topic: normalizedTopic,
        text: normalizedText,
    })
}

async function getQueueCounts() {
    const queue = new Queue<ScrapeQueueJob, void, "scrape">(SCRAPE_QUEUE_NAME, {
        connection: getRedisConnectionOptions(),
    })

    try {
        return await queue.getJobCounts("waiting", "delayed", "active", "completed", "failed", "paused")
    } finally {
        await queue.close()
    }
}

async function waitForRun(runId: string, waitMs: number) {
    const startedAt = Date.now()
    const deadline = startedAt + waitMs
    let jobs = await readRunJobs(runId)

    while (Date.now() < deadline) {
        const done = jobs.every(job => job.status !== ScrapeJobStatus.QUEUED && job.status !== ScrapeJobStatus.RUNNING)
        if (done) break
        await new Promise(resolve => setTimeout(resolve, 5000))
        jobs = await readRunJobs(runId)
        console.log(JSON.stringify({
            waiting_ms: Date.now() - startedAt,
            jobs: jobs.map(job => ({
                id: job.id,
                engine: job.engine,
                status: job.status,
                chat_id: job.chat_id,
                error_reason: job.error_reason,
            })),
        }, null, 2))
    }

    return jobs
}

function readRunJobs(runId: string) {
    return prisma.scrapeJob.findMany({
        where: { run_id: runId },
        orderBy: { created_at: "asc" },
        select: {
            id: true,
            engine: true,
            status: true,
            chat_id: true,
            error_reason: true,
            created_at: true,
            started_at: true,
            completed_at: true,
        },
    })
}

async function main() {
    if (!process.env.QUEUE_FLOW_TEST_SPACING_MS && process.env.QUEUE_FLOW_TEST_FAST !== "false") {
        process.env.SCRAPE_QUEUE_SPACING_MS = "0"
    } else if (process.env.QUEUE_FLOW_TEST_SPACING_MS) {
        process.env.SCRAPE_QUEUE_SPACING_MS = process.env.QUEUE_FLOW_TEST_SPACING_MS
    }

    const engines = parseEngines()
    assertBrightDataEnv(engines)

    const promptText = process.env.QUEUE_FLOW_TEST_PROMPT?.trim() || "best ai visibility saas tools for B2B SaaS"
    const topicName = process.env.QUEUE_FLOW_TEST_TOPIC?.trim() || "Queue Flow Test"
    const waitMs = Number(process.env.QUEUE_FLOW_TEST_WAIT_MS ?? 0)
    const enqueueJobs = process.env.QUEUE_FLOW_TEST_ENQUEUE_JOBS !== "false"
    const { project } = await ensureTestProject()

    await createTopic({ project_id: project.id, name: topicName })
    const prompt = await ensureTestPrompt(project.id, topicName, promptText)

    const { run, jobs } = await enqueueProjectRun({
        project_id: project.id,
        prompt_ids: [prompt.id],
        engines,
        profile: "local-queue-flow-test",
        enqueue_jobs: enqueueJobs,
    })

    const queueCounts = enqueueJobs ? await getQueueCounts() : null
    const finalJobs = waitMs > 0 ? await waitForRun(run.id, waitMs) : await readRunJobs(run.id)

    console.log(JSON.stringify({
        ok: true,
        project: {
            id: project.id,
            brand_name: project.brand_name,
            brand_location: project.brand_location,
        },
        prompt: {
            id: prompt.id,
            text: prompt.text,
            topic: prompt.topic,
        },
        run: {
            id: run.id,
            status: run.status,
        },
        queued_jobs: jobs.map(job => ({
            id: job.id,
            engine: job.engine,
            status: job.status,
            geo: job.geo_country_code,
        })),
        queue_counts: queueCounts,
        db_jobs: finalJobs,
        next_step: enqueueJobs
            ? "Run npm run worker:scrape in another terminal if it is not already running."
            : "Run npm run brightdata:trigger, then npm run brightdata:poll until batches complete.",
    }, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await closeScrapeQueue()
        await prisma.$disconnect()
    })
