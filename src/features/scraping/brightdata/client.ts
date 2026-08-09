import axios from "axios"

import { buildBrightDataInput, getScraperId } from "./engine_registry"
import { extractRecords, normalizeBrightDataRecord } from "./normalizer"
import type { BrightDataInputPayload, BrightDataRecord, UiEngine, UiScrapeResult } from "./types"
import { delay, readString } from "./utils"

export type BrightDataSnapshotProgress = {
    snapshot_id: string
    status: string
    is_ready: boolean
    is_failed: boolean
    raw: unknown
}

const BRIGHT_DATA_BASE_URL = "https://api.brightdata.com"
const READY_STATUSES = new Set(["ready", "done", "success", "completed", "complete"])
const FAILED_STATUSES = new Set(["failed", "error", "canceled", "cancelled"])

export async function runBrightDataScrape(input: {
    engine: UiEngine
    prompt: string
    geo: string
}): Promise<UiScrapeResult> {
    const apiKey = getBrightDataApiKey()
    if (!apiKey) {
        throw new Error("BRIGHT_DATA_API_KEY is missing.")
    }

    const { snapshot_id } = await triggerBrightDataSnapshot({
        engine: input.engine,
        geo: input.geo,
        payloads: [buildBrightDataInput(input.engine, input.prompt, input.geo)],
    })
    const records = await pollAndDownloadSnapshot(apiKey, snapshot_id)

    const record = records[0]
    if (!record) {
        throw new Error("Bright Data returned no records.")
    }

    return normalizeBrightDataRecord(input.engine, input.prompt, record)
}

export async function triggerBrightDataSnapshot(input: {
    engine: UiEngine
    geo?: string | null
    payloads: BrightDataInputPayload[]
}) {
    const apiKey = getBrightDataApiKey()
    if (!apiKey) {
        throw new Error("BRIGHT_DATA_API_KEY is missing.")
    }

    const scraperId = getScraperId(input.engine)
    if (!scraperId) {
        throw new Error(`Bright Data scraper ID is missing for ${input.engine}.`)
    }

    const params: Record<string, string | boolean> = {
        dataset_id: scraperId,
        format: "json",
        include_errors: true,
    }

    if (input.geo) {
        params.gl = input.geo.toUpperCase()
    }

    const customOutputFields = process.env.BRIGHT_DATA_CUSTOM_OUTPUT_FIELDS?.trim()
    if (customOutputFields) params.custom_output_fields = customOutputFields

    const response = await axios.post(
        `${getBrightDataBaseUrl()}/datasets/v3/trigger`,
        input.payloads,
        {
            headers: brightDataHeaders(apiKey),
            params,
            timeout: Number(process.env.BRIGHT_DATA_TRIGGER_TIMEOUT_MS ?? 60000),
            validateStatus: status => status >= 200 && status < 300,
        }
    )

    const snapshotId = response.data?.snapshot_id || response.headers["x-snapshot-id"]
    if (!snapshotId) {
        throw new Error(`Failed to get snapshot ID from BrightData /trigger API. Response: ${JSON.stringify(response.data)}`)
    }

    return {
        snapshot_id: String(snapshotId),
        scraper_id: scraperId,
        raw: response.data,
    }
}

export function getBrightDataApiKey() {
    return (process.env.BRIGHT_DATA_API_KEY ?? "").trim()
}

export function getBrightDataBaseUrl() {
    return (process.env.BRIGHT_DATA_API_BASE_URL ?? BRIGHT_DATA_BASE_URL).replace(/\/$/, "")
}

export function brightDataHeaders(apiKey: string) {
    return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
    }
}

async function pollAndDownloadSnapshot(apiKey: string, snapshotId: string | undefined) {
    if (!snapshotId) {
        throw new Error("Bright Data returned async response without snapshot_id.")
    }

    const startedAt = Date.now()
    const timeoutMs = Number(process.env.BRIGHT_DATA_POLL_TIMEOUT_MS ?? 300000)
    const intervalMs = Number(process.env.BRIGHT_DATA_POLL_INTERVAL_MS ?? 10000)

    while (Date.now() - startedAt < timeoutMs) {
        const progress = await getBrightDataSnapshotProgress(snapshotId, apiKey)
        const status = progress.status

        console.log(`[brightdata-poll] Snapshot ${snapshotId}: status = ${status} (${Math.round((Date.now() - startedAt)/1000)}s elapsed)`)

        if (progress.is_ready) {
            return await downloadBrightDataSnapshot(snapshotId, apiKey)
        }

        if (progress.is_failed) {
            throw new Error(`Bright Data snapshot ${snapshotId} ended with status=${status}.`)
        }

        await delay(intervalMs)
    }

    throw new Error(`Bright Data snapshot ${snapshotId} was not ready within ${timeoutMs}ms.`)
}

export async function getBrightDataSnapshotProgress(snapshotId: string, apiKey = getBrightDataApiKey()): Promise<BrightDataSnapshotProgress> {
    if (!apiKey) {
        throw new Error("BRIGHT_DATA_API_KEY is missing.")
    }

    const response = await axios.get(
        `${getBrightDataBaseUrl()}/datasets/v3/progress/${encodeURIComponent(snapshotId)}`,
        {
            headers: brightDataHeaders(apiKey),
            timeout: Number(process.env.BRIGHT_DATA_PROGRESS_TIMEOUT_MS ?? 30000),
            validateStatus: status => status >= 200 && status < 500,
        }
    )

    const data = Array.isArray(response.data) ? response.data[0] : response.data
    const status = String(readString(data, ["status", "state", "progress"]) ?? "").toLowerCase()

    return {
        snapshot_id: snapshotId,
        status,
        is_ready: READY_STATUSES.has(status),
        is_failed: FAILED_STATUSES.has(status),
        raw: response.data,
    }
}

export async function downloadBrightDataSnapshot(snapshotId: string, apiKey = getBrightDataApiKey()): Promise<BrightDataRecord[]> {
    if (!apiKey) {
        throw new Error("BRIGHT_DATA_API_KEY is missing.")
    }

    const response = await axios.get(
        `${getBrightDataBaseUrl()}/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}`,
        {
            headers: brightDataHeaders(apiKey),
            params: { format: "json" },
            timeout: Number(process.env.BRIGHT_DATA_SNAPSHOT_TIMEOUT_MS ?? 120000),
        }
    )

    return extractRecords(response.data)
}
