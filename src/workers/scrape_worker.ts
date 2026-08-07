import "../lib/env"
import { Engine, ScrapeJobStatus, VisibilityRunStatus } from "@prisma/client"
import { Worker } from "bullmq"
import axios from "axios"
import express from "express"
import Redis from "ioredis"
import prisma from "../lib/prisma"
import { getRedisConnectionOptions } from "../lib/redis"
import { SCRAPE_QUEUE_NAME, type ScrapeQueueJob } from "../queues/scrape_queue"
import { runPrompt } from "../features/dashboard/dashboard_service"
import { buildGeoPromptText } from "../features/prompts/prompt_service"
import { runUiScrape, type UiEngine, type UiScrapeResult } from "../features/scraping/scraper_api_client"
import { isScrapingDisabled } from "../features/scraping/scrape_gate"
import { refundCredits, spendCredits } from "../features/credits/credits_service"
import { getPromptRunCreditCost } from "../features/payments/credits_service"

const engineMap: Record<Engine, UiEngine> = {
    CHATGPT: "chatgpt",
    GEMINI: "gemini",
    PERPLEXITY: "perplexity",
    GOOGLE_AI_OVERVIEW: "google_ai_overview",
    GOOGLE_AI_MODE: "google_ai_mode",
    COPILOT: "copilot",
}

// ─── Redis singleton for caching (separate from BullMQ connection) ─────────
let _cacheRedis: Redis | null = null
function getCacheRedis(): Redis {
    if (!_cacheRedis) {
        _cacheRedis = new Redis(getRedisConnectionOptions())
        _cacheRedis.on("error", (err: Error) => console.error("[cache-redis]", err.message))
    }
    return _cacheRedis
}

// ─── Cache TTL: 20 hours for normal prompts ────────────────────────────────
const CACHE_TTL_SECONDS = Number(process.env.SCRAPE_CACHE_TTL_SECONDS ?? 72000)

/**
 * Cross-user deduplication: cache key is engine+geo+prompt (normalized).
 * If 10 users have the same prompt on the same engine, only ONE scrape fires.
 */
function buildCacheKey(engine: UiEngine, geo: string, prompt: string): string {
    const normalizedPrompt = prompt.toLowerCase().replace(/\s+/g, " ").trim()
    const hash = Buffer.from(`${engine}:${geo.toUpperCase()}:${normalizedPrompt}`).toString("base64url").slice(0, 40)
    return `sc:v3:${hash}`
}

function toScrapeJobStatus(status: UiScrapeResult["status"]) {
    if (status === "success") return ScrapeJobStatus.SUCCESS
    if (status === "manual_needed") return ScrapeJobStatus.MANUAL_NEEDED
    if (status === "rate_limited") return ScrapeJobStatus.RATE_LIMITED
    return ScrapeJobStatus.FAILED
}

function formatWorkerError(error: unknown) {
    if (axios.isAxiosError(error)) {
        const url = error.config?.url
        const status = error.response?.status
        const detail = typeof error.response?.data === "string"
            ? error.response.data.slice(0, 240)
            : error.response?.data
                ? JSON.stringify(error.response.data).slice(0, 240)
                : undefined

        return [
            error.code ?? "AXIOS_ERROR",
            error.message,
            url ? `url=${url}` : undefined,
            status ? `status=${status}` : undefined,
            detail ? `detail=${detail}` : undefined,
        ].filter(Boolean).join(" | ")
    }

    return error instanceof Error ? error.message : String(error)
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
    await import("../features/seo/onboarding/onboarding_service")
        .then(module => module.finalizeOnboardingVisibility(run_id))
        .catch(error => console.error("Could not finalize SEO onboarding visibility", error))
}

async function processScrapeJob(scrape_job_id: string) {
    const scrapeJob = await prisma.scrapeJob.findUniqueOrThrow({
        where: { id: scrape_job_id },
        include: { prompt: true, project: { select: { user_id: true } } }
    })

    // Guard: if job was already completed by a previous BullMQ retry, skip it
    if (scrapeJob.status === ScrapeJobStatus.SUCCESS) {
        console.log(`Scrape job ${scrape_job_id} already succeeded — skipping duplicate BullMQ delivery`)
        return
    }

    if (isScrapingDisabled()) {
        await prisma.scrapeJob.update({
            where: { id: scrapeJob.id },
            data: {
                status: ScrapeJobStatus.FAILED,
                completed_at: new Date(),
                error_reason: "Scraping disabled by administrator for all projects.",
            },
        })
        await refreshRunStatus(scrapeJob.run_id)
        return
    }

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

    const engine = engineMap[scrapeJob.engine]
    const geo = (scrapeJob.geo_country_code ?? process.env.SCRAPER_DEFAULT_GEO ?? "US").toUpperCase()
    console.log(`[scraper] job=${scrapeJob.id} engine=${engine} geo=${geo} provider=brightdata`)

    // ── Cross-user cache: check if we already have a fresh result for this prompt ──
    const cacheKey = buildCacheKey(engine, geo, promptTextToRun)
    const cache = getCacheRedis()
    let result: UiScrapeResult | null = null
    let servedFromCache = false

    try {
        const cached = await cache.get(cacheKey)
        if (cached) {
            result = JSON.parse(cached) as UiScrapeResult
            servedFromCache = true
            console.log(`[cache-hit] job=${scrapeJob.id} engine=${engine} geo=${geo} key=${cacheKey}`)
        }
    } catch (e) {
        console.error("[cache] Redis read error:", e)
    }

    if (!result) {
        result = await runUiScrape({
            engine,
            prompt: promptTextToRun,
            geo,
        })

        // Cache only clean successful results (not manual_needed which means login wall)
        const isFallbackResult = result.model_label.includes("api-fallback")
        if (result.status === "success" && result.answer_text && !isFallbackResult) {
            try {
                await cache.set(cacheKey, JSON.stringify(result), "EX", CACHE_TTL_SECONDS)
                console.log(`[cache-set] engine=${engine} geo=${geo} ttl=${CACHE_TTL_SECONDS}s`)
            } catch (e) {
                console.error("[cache] Redis write error:", e)
            }
        }
    }

    const status = toScrapeJobStatus(result.status)
    let chat_id: string | undefined

    if (status === ScrapeJobStatus.SUCCESS && result.answer_text) {
        const unitCreditCost = await getPromptRunCreditCost(scrapeJob.project.user_id)
        const chargeKey = `prompt-run:${scrapeJob.id}:v2`
        try {
            await spendCredits({
                userId: scrapeJob.project.user_id,
                amount: unitCreditCost,
                action: "PROMPT_RUN",
                description: `${scrapeJob.engine} visibility check`,
                idempotencyKey: chargeKey,
                metadata: { run_id: scrapeJob.run_id, scrape_job_id: scrapeJob.id, engine: scrapeJob.engine, unit_credit_cost: unitCreditCost },
            })
        } catch (error) {
            const reason = error instanceof Error ? error.message : "Insufficient credits"
            await prisma.scrapeJob.update({
                where: { id: scrapeJob.id },
                data: { status: ScrapeJobStatus.FAILED, error_reason: reason, completed_at: new Date() },
            })
            await refreshRunStatus(scrapeJob.run_id)
            throw error
        }

        let chat
        try {
            chat = await runPrompt({
                prompt_id: scrapeJob.prompt_id,
                run_id: scrapeJob.run_id,
                geo_variant_id: scrapeJob.geo_variant_id,
                geo_country_code: scrapeJob.geo_country_code,
                geo_country_name: scrapeJob.geo_country_name,
                geo_city: scrapeJob.geo_city,
                raw_response: result.answer_text,
                ai_model: servedFromCache ? `${result.model_label ?? engine}-cached` : result.model_label,
                screenshot_path: result.screenshot_path,
                citations: result.citations
            })
        } catch (error) {
            await refundCredits({
                userId: scrapeJob.project.user_id,
                amount: unitCreditCost,
                action: "PROMPT_RUN",
                description: "Refund for AI result that could not be analyzed",
                idempotencyKey: chargeKey,
                metadata: { run_id: scrapeJob.run_id, scrape_job_id: scrapeJob.id },
            }).catch((refundError: unknown) => console.error("Could not refund failed AI analysis", refundError))
            throw error
        }
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
            raw_text: null, // Not stored - saves significant DB space (was storing full BrightData JSON / page body)
            citations: result.citations,
            screenshot_path: result.screenshot_path,
            retry_count: result.retry_count ?? 0,
            error_reason: result.error_reason,
            completed_at: new Date()
        }
    })

    await refreshRunStatus(scrapeJob.run_id)

    // Throw for BullMQ to retry on transient failures only (FAILED / RATE_LIMITED)
    // Do NOT throw for MANUAL_NEEDED — login walls won't fix themselves on retry
    if (status === ScrapeJobStatus.FAILED || status === ScrapeJobStatus.RATE_LIMITED) {
        throw new Error(result.error_reason ?? `Scrape ended with ${status}`)
    }
}

// Scrapes (especially ChatGPT) can take 90-180s.
// lockDuration must be longer than the longest expected job or BullMQ marks it stalled.
// We also extend the lock every LOCK_RENEW_MS so indefinitely-long jobs don't stall either.
const LOCK_DURATION_MS = Number(process.env.SCRAPE_WORKER_LOCK_DURATION_MS ?? 900000)  // 15 min
const LOCK_RENEW_MS = Number(process.env.SCRAPE_WORKER_LOCK_RENEW_MS ?? 15000)         // renew every 15s

const worker = new Worker<ScrapeQueueJob, void, "scrape">(
    SCRAPE_QUEUE_NAME,
    async job => {
        // Keep the BullMQ lock alive for the full duration of the scrape.
        // Without this, BullMQ evicts the job as "stalled" after lockDuration ms.
        const lockExtender = setInterval(async () => {
            try {
                await (job as any).extendLock(LOCK_DURATION_MS)
            } catch {
                // Job may have already completed — ignore
            }
        }, LOCK_RENEW_MS)

        try {
            await processScrapeJob(job.data.scrape_job_id)
        } finally {
            clearInterval(lockExtender)
        }
    },
    {
        connection: getRedisConnectionOptions(),
        concurrency: Number(process.env.SCRAPE_WORKER_CONCURRENCY ?? 5),
        lockDuration: LOCK_DURATION_MS,
        stalledInterval: 30000,
        maxStalledCount: 1,
        limiter: {
            max: Number(process.env.SCRAPE_WORKER_RATE_MAX ?? 10),
            duration: Number(process.env.SCRAPE_WORKER_RATE_WINDOW_MS ?? 60000),
        }
    }
)

worker.on("completed", job => {
    console.log(`[worker] job completed: ${job?.data.scrape_job_id}`)
})

worker.on("failed", async (job, error) => {
    const scrape_job_id = job?.data.scrape_job_id
    if (scrape_job_id) {
        try {
            const scrapeJob = await prisma.scrapeJob.update({
                where: { id: scrape_job_id },
                data: {
                    status: ScrapeJobStatus.FAILED,
                    error_reason: error.message.slice(0, 500),
                    completed_at: new Date()
                }
            })
            await refreshRunStatus(scrapeJob.run_id)
        } catch (updateError) {
            if (updateError instanceof Error && updateError.message.includes("No record was found")) {
                console.warn(`Scrape job ${scrape_job_id} no longer exists; ignoring stale Redis job ${job?.id}`)
            } else {
                console.error(`Could not mark scrape job ${scrape_job_id} as failed`, updateError)
            }
        }
    }
    console.error(`[worker] job failed: ${job?.id} | attempts=${job?.attemptsMade} | ${formatWorkerError(error)}`)
})

worker.on("stalled", async (jobId) => {
    // A stalled job means the worker crashed mid-execution. Mark it failed in Postgres.
    console.warn(`[worker] job stalled (worker crashed?): ${jobId}`)
})

if (process.env.PORT) {
    const app = express()
    const port = Number(process.env.PORT)

    app.get("/", (_req, res) => {
        res.json({
            service: "scrape-worker",
            status: "ok",
            queue: SCRAPE_QUEUE_NAME,
            concurrency: Number(process.env.SCRAPE_WORKER_CONCURRENCY ?? 5),
        })
    })

    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            queue: SCRAPE_QUEUE_NAME,
            worker_running: worker.isRunning(),
            concurrency: worker.concurrency,
        })
    })

    app.listen(port, "0.0.0.0", () => {
        console.log(`Scrape worker health server listening on :${port}`)
    })
}

async function shutdown() {
    console.log("[worker] Shutting down gracefully...")
    await worker.close()
    if (_cacheRedis) await _cacheRedis.quit()
    await prisma.$disconnect()
    process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
