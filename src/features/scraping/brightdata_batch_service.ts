import {
    BrightDataBatchItemStatus,
    BrightDataBatchStatus,
    Engine,
    Prisma,
    ScrapeJobStatus,
    VisibilityRunStatus,
} from "@prisma/client"
import prisma from "../../lib/prisma"
import { runPrompt } from "../dashboard/dashboard_service"
import { buildGeoPromptText } from "../prompts/prompt_service"
import { buildBrightDataInput, getScraperId } from "./brightdata/engine_registry"
import {
    downloadBrightDataSnapshot,
    getBrightDataSnapshotProgress,
    triggerBrightDataSnapshot,
} from "./brightdata/client"
import { normalizeBrightDataRecord } from "./brightdata/normalizer"
import type { BrightDataRecord, UiEngine } from "./brightdata/types"
import { isRecord, normalizeErrorMessage, readNumber, readString } from "./brightdata/utils"
import { refreshRunStatus } from "./run_status_service"

type ScrapeJobWithPrompt = Prisma.ScrapeJobGetPayload<{
    include: { prompt: true }
}>

type BrightDataBatchWithItems = Prisma.BrightDataBatchGetPayload<{
    include: {
        items: {
            include: {
                scrape_job: {
                    include: { prompt: true }
                }
            }
        }
    }
}>

const engineMap: Record<Engine, UiEngine> = {
    CHATGPT: "chatgpt",
    GEMINI: "gemini",
    PERPLEXITY: "perplexity",
    GOOGLE_AI_OVERVIEW: "google_ai_overview",
    GOOGLE_AI_MODE: "google_ai_mode",
    COPILOT: "copilot",
}

export async function triggerQueuedBrightDataBatches(options: {
    limit?: number
    batch_size?: number
} = {}) {
    const limit = options.limit ?? Number(process.env.BRIGHT_DATA_BATCH_TRIGGER_LIMIT ?? 1000)
    const batchSize = Math.max(1, Math.min(
        options.batch_size ?? Number(process.env.BRIGHT_DATA_BATCH_SIZE ?? 500),
        Number(process.env.BRIGHT_DATA_BATCH_MAX_SIZE ?? 5000)
    ))

    const jobs = await prisma.scrapeJob.findMany({
        where: {
            status: ScrapeJobStatus.QUEUED,
            bright_data_batch_item: null,
        },
        include: { prompt: true },
        orderBy: { created_at: "asc" },
        take: limit,
    })

    const groups = groupJobs(jobs)
    const batches = []

    for (const group of groups.values()) {
        for (let offset = 0; offset < group.jobs.length; offset += batchSize) {
            const chunk = group.jobs.slice(offset, offset + batchSize)
            batches.push(await createAndTriggerBatch(group.engine, group.geo, chunk))
        }
    }

    return {
        queued_jobs: jobs.length,
        batches,
    }
}

export async function pollBrightDataBatches(options: {
    limit?: number
} = {}) {
    const now = new Date()
    const limit = options.limit ?? Number(process.env.BRIGHT_DATA_POLLER_BATCH_LIMIT ?? 20)

    const batches = await prisma.brightDataBatch.findMany({
        where: {
            status: { in: [BrightDataBatchStatus.TRIGGERED, BrightDataBatchStatus.RUNNING] },
            OR: [
                { next_poll_at: null },
                { next_poll_at: { lte: now } },
            ],
        },
        include: {
            items: {
                orderBy: { input_index: "asc" },
                include: {
                    scrape_job: {
                        include: { prompt: true },
                    },
                },
            },
        },
        orderBy: { created_at: "asc" },
        take: limit,
    })

    const results = []
    for (const batch of batches) {
        results.push(await pollOneBatch(batch))
    }

    return {
        polled_batches: results.length,
        batches: results,
    }
}

function groupJobs(jobs: ScrapeJobWithPrompt[]) {
    const groups = new Map<string, { engine: Engine; geo: string; jobs: ScrapeJobWithPrompt[] }>()

    for (const job of jobs) {
        const geo = (job.geo_country_code ?? process.env.SCRAPER_DEFAULT_GEO ?? "US").toUpperCase()
        const key = `${job.engine}:${geo}`
        const existing = groups.get(key)
        if (existing) {
            existing.jobs.push(job)
        } else {
            groups.set(key, { engine: job.engine, geo, jobs: [job] })
        }
    }

    return groups
}

async function createAndTriggerBatch(engine: Engine, geo: string, jobs: ScrapeJobWithPrompt[]) {
    const uiEngine = engineMap[engine]
    const scraperId = getScraperId(uiEngine)
    if (!scraperId) throw new Error(`Bright Data scraper ID is missing for ${uiEngine}.`)

    const payloads = jobs.map((job, index) => {
        const inputIndex = index + 1
        return buildBrightDataInput(uiEngine, promptTextForJob(job), geo, inputIndex)
    })

    const batch = await prisma.brightDataBatch.create({
        data: {
            engine,
            geo_country_code: geo,
            scraper_id: scraperId,
            input_count: jobs.length,
            items: {
                create: jobs.map((job, index) => ({
                    scrape_job_id: job.id,
                    input_index: index + 1,
                })),
            },
        },
        include: { items: true },
    })

    try {
        const snapshot = await triggerBrightDataSnapshot({ engine: uiEngine, geo, payloads })
        const startedAt = new Date()
        const nextPollAt = new Date(startedAt.getTime() + Number(process.env.BRIGHT_DATA_INITIAL_POLL_DELAY_MS ?? 20000))
        const runIds = [...new Set(jobs.map(job => job.run_id))]

        await prisma.$transaction([
            prisma.brightDataBatch.update({
                where: { id: batch.id },
                data: {
                    status: BrightDataBatchStatus.TRIGGERED,
                    snapshot_id: snapshot.snapshot_id,
                    triggered_at: startedAt,
                    next_poll_at: nextPollAt,
                },
            }),
            prisma.scrapeJob.updateMany({
                where: { id: { in: jobs.map(job => job.id) } },
                data: {
                    status: ScrapeJobStatus.RUNNING,
                    started_at: startedAt,
                    error_reason: null,
                },
            }),
            prisma.run.updateMany({
                where: { id: { in: runIds } },
                data: {
                    status: VisibilityRunStatus.RUNNING,
                    started_at: startedAt,
                },
            }),
        ])

        return {
            id: batch.id,
            engine,
            geo,
            snapshot_id: snapshot.snapshot_id,
            input_count: jobs.length,
            status: BrightDataBatchStatus.TRIGGERED,
        }
    } catch (error) {
        const message = normalizeErrorMessage(error)
        await markWholeBatchFailed(batch.id, jobs, BrightDataBatchStatus.FAILED, message)
        return {
            id: batch.id,
            engine,
            geo,
            snapshot_id: null,
            input_count: jobs.length,
            status: BrightDataBatchStatus.FAILED,
            error_reason: message,
        }
    }
}

async function pollOneBatch(batch: BrightDataBatchWithItems) {
    if (!batch.snapshot_id) {
        await markWholeBatchFailed(batch.id, batch.items.map(item => item.scrape_job), BrightDataBatchStatus.FAILED, "BrightData batch has no snapshot_id.")
        return { id: batch.id, status: BrightDataBatchStatus.FAILED, error_reason: "Missing snapshot_id" }
    }

    if (isBatchTimedOut(batch)) {
        const message = `BrightData snapshot ${batch.snapshot_id} timed out.`
        await markWholeBatchFailed(batch.id, batch.items.map(item => item.scrape_job), BrightDataBatchStatus.TIMED_OUT, message)
        return { id: batch.id, snapshot_id: batch.snapshot_id, status: BrightDataBatchStatus.TIMED_OUT, error_reason: message }
    }

    const progress = await getBrightDataSnapshotProgress(batch.snapshot_id)

    if (progress.is_failed) {
        const message = `BrightData snapshot ${batch.snapshot_id} ended with status=${progress.status}.`
        await markWholeBatchFailed(batch.id, batch.items.map(item => item.scrape_job), BrightDataBatchStatus.FAILED, message)
        return { id: batch.id, snapshot_id: batch.snapshot_id, status: BrightDataBatchStatus.FAILED, error_reason: message }
    }

    if (!progress.is_ready) {
        await prisma.brightDataBatch.update({
            where: { id: batch.id },
            data: {
                status: BrightDataBatchStatus.RUNNING,
                last_polled_at: new Date(),
                next_poll_at: nextPollDate(batch),
            },
        })

        return { id: batch.id, snapshot_id: batch.snapshot_id, status: BrightDataBatchStatus.RUNNING, progress: progress.status }
    }

    const records = await downloadBrightDataSnapshot(batch.snapshot_id)
    return completeBatchFromRecords(batch, records)
}

async function completeBatchFromRecords(batch: BrightDataBatchWithItems, records: BrightDataRecord[]) {
    const uiEngine = engineMap[batch.engine]
    const recordsByIndex = mapRecordsByIndex(records, batch.items)
    let completed = 0
    let failed = 0
    const runIds = new Set<string>()

    for (const item of batch.items) {
        runIds.add(item.scrape_job.run_id)
        if (item.status === BrightDataBatchItemStatus.SUCCESS || item.scrape_job.status === ScrapeJobStatus.SUCCESS) {
            completed += 1
            continue
        }

        const record = recordsByIndex.get(item.input_index)
        if (!record) {
            failed += 1
            await markBatchItemFailed(item.id, item.scrape_job, `BrightData returned no record for index ${item.input_index}.`)
            continue
        }

        try {
            const promptText = promptTextForJob(item.scrape_job)
            const result = normalizeBrightDataRecord(uiEngine, promptText, record)

            if (result.status !== "success" || !result.answer_text) {
                failed += 1
                await markBatchItemFailed(item.id, item.scrape_job, result.error_reason ?? "BrightData returned an empty answer.")
                continue
            }

            const chat = await runPrompt({
                prompt_id: item.scrape_job.prompt_id,
                run_id: item.scrape_job.run_id,
                geo_variant_id: item.scrape_job.geo_variant_id,
                geo_country_code: item.scrape_job.geo_country_code,
                geo_country_name: item.scrape_job.geo_country_name,
                geo_city: item.scrape_job.geo_city,
                raw_response: result.answer_text,
                ai_model: result.model_label,
                screenshot_path: result.screenshot_path,
                citations: result.citations,
                enqueue_source_enrichment: process.env.SOURCE_ENRICHMENT_AUTO_ENQUEUE !== "false",
                ingest_chat: false,
            })

            await prisma.$transaction([
                prisma.prompt.update({
                    where: { id: item.scrape_job.prompt_id },
                    data: { last_run_at: new Date() },
                }),
                prisma.scrapeJob.update({
                    where: { id: item.scrape_job.id },
                    data: {
                        status: ScrapeJobStatus.SUCCESS,
                        chat_id: chat.id,
                        answer_text: result.answer_text,
                        raw_text: result.raw_text,
                        citations: result.citations,
                        screenshot_path: result.screenshot_path,
                        retry_count: result.retry_count ?? 0,
                        error_reason: result.error_reason,
                        completed_at: new Date(),
                    },
                }),
                prisma.brightDataBatchItem.update({
                    where: { id: item.id },
                    data: {
                        status: BrightDataBatchItemStatus.SUCCESS,
                        error_reason: null,
                    },
                }),
            ])

            completed += 1
        } catch (error) {
            failed += 1
            await markBatchItemFailed(item.id, item.scrape_job, normalizeErrorMessage(error))
        }
    }

    const status = completed === batch.items.length
        ? BrightDataBatchStatus.SUCCESS
        : completed > 0
            ? BrightDataBatchStatus.PARTIAL_SUCCESS
            : BrightDataBatchStatus.FAILED

    await prisma.brightDataBatch.update({
        where: { id: batch.id },
        data: {
            status,
            completed_count: completed,
            failed_count: failed,
            last_polled_at: new Date(),
            next_poll_at: null,
            completed_at: new Date(),
            error_reason: failed > 0 ? `${failed} of ${batch.items.length} batch items failed.` : null,
        },
    })

    await Promise.all([...runIds].map(runId => refreshRunStatus(runId)))

    return {
        id: batch.id,
        snapshot_id: batch.snapshot_id,
        status,
        completed,
        failed,
        input_count: batch.items.length,
    }
}

function mapRecordsByIndex(records: BrightDataRecord[], items: BrightDataBatchWithItems["items"]) {
    const byIndex = new Map<number, BrightDataRecord>()
    const usedRecordPositions = new Set<number>()
    const validIndexes = new Set(items.map(item => item.input_index))

    records.forEach((record, position) => {
        const index = readRecordInputIndex(record)
        if (!index || !validIndexes.has(index) || byIndex.has(index)) return

        byIndex.set(index, record)
        usedRecordPositions.add(position)
    })

    const itemByPrompt = mapItemsByPrompt(items)
    records.forEach((record, position) => {
        if (usedRecordPositions.has(position)) return

        const prompt = readRecordPrompt(record)
        const item = prompt ? itemByPrompt.get(normalizePromptKey(prompt)) : undefined
        if (!item || byIndex.has(item.input_index)) return

        byIndex.set(item.input_index, record)
        usedRecordPositions.add(position)
    })

    const unmatchedItems = items.filter(item => !byIndex.has(item.input_index))
    const unmatchedRecords = records.filter((_, position) => !usedRecordPositions.has(position))

    unmatchedItems.forEach((item, index) => {
        const record = unmatchedRecords[index]
        if (record) byIndex.set(item.input_index, record)
    })

    return byIndex
}

function readRecordInputIndex(record: BrightDataRecord) {
    const direct = readNumber(record, ["input_index", "custom_id", "index"])
    if (direct && direct > 0) return direct

    const input = record.input
    if (isRecord(input)) {
        const nested = readNumber(input, ["input_index", "custom_id", "index"])
        if (nested && nested > 0) return nested
    }

    return undefined
}

function readRecordPrompt(record: BrightDataRecord) {
    const direct = readString(record, ["prompt", "query", "search_query"])
    if (direct) return direct

    const input = record.input
    return isRecord(input) ? readString(input, ["prompt", "query", "search_query"]) : undefined
}

function mapItemsByPrompt(items: BrightDataBatchWithItems["items"]) {
    const byPrompt = new Map<string, BrightDataBatchWithItems["items"][number]>()
    const duplicatePrompts = new Set<string>()

    for (const item of items) {
        const key = normalizePromptKey(promptTextForJob(item.scrape_job))
        if (!key) continue

        if (byPrompt.has(key)) {
            duplicatePrompts.add(key)
            byPrompt.delete(key)
            continue
        }

        if (!duplicatePrompts.has(key)) byPrompt.set(key, item)
    }

    return byPrompt
}

function normalizePromptKey(value: string) {
    return value.toLowerCase().replace(/\s+/g, " ").trim()
}

async function markBatchItemFailed(itemId: string, job: ScrapeJobWithPrompt, reason: string) {
    await prisma.$transaction([
        prisma.brightDataBatchItem.update({
            where: { id: itemId },
            data: {
                status: BrightDataBatchItemStatus.FAILED,
                error_reason: reason.slice(0, 1000),
            },
        }),
        prisma.scrapeJob.update({
            where: { id: job.id },
            data: {
                status: ScrapeJobStatus.FAILED,
                error_reason: reason.slice(0, 500),
                completed_at: new Date(),
            },
        }),
    ])
}

async function markWholeBatchFailed(
    batchId: string,
    jobs: ScrapeJobWithPrompt[],
    status: BrightDataBatchStatus,
    reason: string
) {
    const jobIds = jobs.map(job => job.id)
    const runIds = [...new Set(jobs.map(job => job.run_id))]

    await prisma.$transaction([
        prisma.brightDataBatch.update({
            where: { id: batchId },
            data: {
                status,
                failed_count: jobs.length,
                error_reason: reason.slice(0, 1000),
                next_poll_at: null,
                completed_at: new Date(),
            },
        }),
        prisma.brightDataBatchItem.updateMany({
            where: { batch_id: batchId },
            data: {
                status: BrightDataBatchItemStatus.FAILED,
                error_reason: reason.slice(0, 1000),
            },
        }),
        prisma.scrapeJob.updateMany({
            where: { id: { in: jobIds } },
            data: {
                status: ScrapeJobStatus.FAILED,
                error_reason: reason.slice(0, 500),
                completed_at: new Date(),
            },
        }),
    ])

    await Promise.all(runIds.map(runId => refreshRunStatus(runId)))
}

function promptTextForJob(job: ScrapeJobWithPrompt) {
    return job.geo_variant_id && job.geo_country_name
        ? buildGeoPromptText(job.prompt.text, job.geo_country_name, job.geo_city)
        : job.prompt.text
}

function isBatchTimedOut(batch: BrightDataBatchWithItems) {
    const startedAt = batch.triggered_at ?? batch.created_at
    const timeoutMs = Number(process.env.BRIGHT_DATA_BATCH_TIMEOUT_MS ?? 48 * 60 * 60 * 1000)
    return Date.now() - startedAt.getTime() > timeoutMs
}

function nextPollDate(batch: BrightDataBatchWithItems) {
    const startedAt = batch.triggered_at ?? batch.created_at
    const elapsedMs = Date.now() - startedAt.getTime()
    const intervalMs = elapsedMs < 2 * 60 * 1000
        ? Number(process.env.BRIGHT_DATA_POLL_INTERVAL_FAST_MS ?? 20000)
        : elapsedMs < 10 * 60 * 1000
            ? Number(process.env.BRIGHT_DATA_POLL_INTERVAL_NORMAL_MS ?? 45000)
            : Number(process.env.BRIGHT_DATA_POLL_INTERVAL_SLOW_MS ?? 120000)

    return new Date(Date.now() + intervalMs)
}
