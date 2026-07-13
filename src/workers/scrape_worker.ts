import "dotenv/config"
import { Engine, ScrapeJobStatus, VisibilityRunStatus } from "@prisma/client"
import { Worker } from "bullmq"
import express from "express"
import prisma from "../lib/prisma"
import { getRedisConnectionOptions } from "../lib/redis"
import { SCRAPE_QUEUE_NAME, type ScrapeQueueJob } from "../queues/scrape_queue"
import { runPrompt } from "../features/dashboard/dashboard_service"
import { buildGeoPromptText } from "../features/prompts/prompt_service"
import { runUiScrape, type UiEngine, type UiScrapeResult } from "../features/scraping/scraper_api_client"

const engineMap: Record<Engine, UiEngine> = {
    CHATGPT: "chatgpt",
    GEMINI: "gemini",
    PERPLEXITY: "perplexity",
    GOOGLE_AI_OVERVIEW: "google_ai_overview",
    GOOGLE_AI_MODE: "google_ai_mode"
}

function toScrapeJobStatus(status: UiScrapeResult["status"]) {
    if (status === "success") return ScrapeJobStatus.SUCCESS
    if (status === "manual_needed") return ScrapeJobStatus.MANUAL_NEEDED
    if (status === "rate_limited") return ScrapeJobStatus.RATE_LIMITED
    return ScrapeJobStatus.FAILED
}

async function refreshRunStatus(run_id: string) {
    const jobs = await prisma.scrapeJob.findMany({ where: { run_id } })
    const done = jobs.every(job => job.status !== ScrapeJobStatus.QUEUED && job.status !== ScrapeJobStatus.RUNNING)
    if (!done) return

    const successCount = jobs.filter(job => job.status === ScrapeJobStatus.SUCCESS).length
    const status = successCount === jobs.length
        ? VisibilityRunStatus.SUCCESS
        : successCount > 0
            ? VisibilityRunStatus.PARTIAL_SUCCESS
            : VisibilityRunStatus.FAILED

    await prisma.run.update({
        where: { id: run_id },
        data: {
            status,
            completed_at: new Date()
        }
    })
}

async function processScrapeJob(scrape_job_id: string) {
    const scrapeJob = await prisma.scrapeJob.findUniqueOrThrow({
        where: { id: scrape_job_id },
        include: { prompt: true }
    })

    await prisma.run.update({
        where: { id: scrapeJob.run_id },
        data: {
            status: VisibilityRunStatus.RUNNING,
            started_at: new Date()
        }
    })

    await prisma.scrapeJob.update({
        where: { id: scrapeJob.id },
        data: {
            status: ScrapeJobStatus.RUNNING,
            started_at: new Date(),
            error_reason: null
        }
    })

    const isGeoJob = Boolean(scrapeJob.geo_variant_id)
    const promptTextToRun = isGeoJob && scrapeJob.geo_country_name
        ? buildGeoPromptText(scrapeJob.prompt.text, scrapeJob.geo_country_name, scrapeJob.geo_city)
        : scrapeJob.prompt.text

    const result = await runUiScrape({
        engine: engineMap[scrapeJob.engine],
        prompt: promptTextToRun,
        profile: scrapeJob.profile
    })

    const status = toScrapeJobStatus(result.status)
    let chat_id: string | undefined

    if (status === ScrapeJobStatus.SUCCESS && result.answer_text) {
        const chat = await runPrompt({
            prompt_id: scrapeJob.prompt_id,
            run_id: scrapeJob.run_id,
            geo_variant_id: scrapeJob.geo_variant_id,
            geo_country_code: scrapeJob.geo_country_code,
            geo_country_name: scrapeJob.geo_country_name,
            geo_city: scrapeJob.geo_city,
            raw_response: result.answer_text,
            ai_model: result.model_label,
            screenshot_path: result.screenshot_path,
            citations: result.citations
        })
        chat_id = chat.id

        await prisma.prompt.update({
            where: { id: scrapeJob.prompt_id },
            data: { last_run_at: new Date() }
        })
    }

    await prisma.scrapeJob.update({
        where: { id: scrapeJob.id },
        data: {
            status,
            chat_id,
            answer_text: result.answer_text,
            raw_text: result.raw_text,
            citations: result.citations,
            screenshot_path: result.screenshot_path,
            retry_count: result.retry_count ?? 0,
            error_reason: result.error_reason,
            completed_at: new Date()
        }
    })

    await refreshRunStatus(scrapeJob.run_id)

    if (status === ScrapeJobStatus.FAILED || status === ScrapeJobStatus.RATE_LIMITED) {
        throw new Error(result.error_reason ?? `Scrape ended with ${status}`)
    }
}

const worker = new Worker<ScrapeQueueJob, void, "scrape">(
    SCRAPE_QUEUE_NAME,
    async job => {
        await processScrapeJob(job.data.scrape_job_id)
    },
    {
        connection: getRedisConnectionOptions(),
        concurrency: Number(process.env.SCRAPE_WORKER_CONCURRENCY ?? 1)
    }
)

worker.on("completed", job => {
    console.log(`Scrape job completed: ${job.id}`)
})

worker.on("failed", async (job, error) => {
    const scrape_job_id = job?.data.scrape_job_id
    if (scrape_job_id) {
        const scrapeJob = await prisma.scrapeJob.update({
            where: { id: scrape_job_id },
            data: {
                status: ScrapeJobStatus.FAILED,
                error_reason: error.message,
                completed_at: new Date()
            }
        })
        await refreshRunStatus(scrapeJob.run_id)
    }
    console.error(`Scrape job failed: ${job?.id}`, error)
})

if (process.env.PORT) {
    const app = express()
    const port = Number(process.env.PORT)

    app.get("/", (_req, res) => {
        res.json({
            service: "scrape-worker",
            status: "ok",
            queue: SCRAPE_QUEUE_NAME
        })
    })

    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            queue: SCRAPE_QUEUE_NAME,
            worker_running: worker.isRunning()
        })
    })

    app.listen(port, "0.0.0.0", () => {
        console.log(`Scrape worker health server listening on ${port}`)
    })
}

process.on("SIGINT", async () => {
    await worker.close()
    await prisma.$disconnect()
    process.exit(0)
})

process.on("SIGTERM", async () => {
    await worker.close()
    await prisma.$disconnect()
    process.exit(0)
})
