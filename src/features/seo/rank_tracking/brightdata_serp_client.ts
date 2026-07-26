import axios from "axios"
import { downloadBrightDataSnapshot, getBrightDataApiKey, getBrightDataBaseUrl, getBrightDataSnapshotProgress, brightDataHeaders } from "../../scraping/brightdata/client"
import type { BrightDataSerpRecord, SeoRankResultInput } from "./serp_types"

const DEFAULT_SERP_DATASET_ID = "gd_mfz5x93lmsjjjylob"

function datasetId() {
    return (process.env.BRIGHT_DATA_SERP_DATASET_ID ?? DEFAULT_SERP_DATASET_ID).trim()
}

function buildInput(input: SeoRankResultInput, index: number) {
    const queryUrl = new URL("https://www.google.com/search")
    queryUrl.searchParams.set("q", input.keyword)
    queryUrl.searchParams.set("hl", input.language)
    queryUrl.searchParams.set("gl", input.country.toLowerCase())
    // We only need the first 20 organic positions for practical rank tracking.
    queryUrl.searchParams.set("num", "10")
    queryUrl.searchParams.set("pws", "0")

    return {
        url: queryUrl.toString(),
        keyword: input.keyword,
        language: input.language,
        country: input.country.toUpperCase(),
        start_page: 1,
        end_page: 2,
        brd_mobile: "desktop",
        include_paginated_html: false,
        tbs: "",
        tbm: "",
        nfpr: "1",
        index: `seo-${index}-${Date.now()}`,
        collapse_aio: true,
        udm_web: true,
    }
}

function isReady(status: string) {
    return new Set(["ready", "done", "success", "completed", "complete"]).has(status)
}

function isFailed(status: string) {
    return new Set(["failed", "error", "canceled", "cancelled"]).has(status)
}

export function isBrightDataSerpConfigured() {
    return Boolean(getBrightDataApiKey() && datasetId())
}

export async function runBrightDataSerp(inputs: SeoRankResultInput[]): Promise<BrightDataSerpRecord[]> {
    const apiKey = getBrightDataApiKey()
    if (!apiKey) throw new Error("BRIGHT_DATA_API_KEY is missing.")
    if (!inputs.length) return []

    const response = await axios.post(
        `${getBrightDataBaseUrl()}/datasets/v3/trigger`,
        {
            input: inputs.map(buildInput),
            limit_per_input: 20,
        },
        {
            headers: brightDataHeaders(apiKey),
            params: { dataset_id: datasetId(), notify: "false", format: "json", include_errors: true },
            timeout: Number(process.env.BRIGHT_DATA_SERP_TRIGGER_TIMEOUT_MS ?? 60000),
            validateStatus: status => status >= 200 && status < 300,
        },
    )
    const snapshotId = response.data?.snapshot_id || response.headers["x-snapshot-id"]
    if (!snapshotId) throw new Error("Bright Data SERP did not return a snapshot ID.")

    const timeoutMs = Number(process.env.BRIGHT_DATA_SERP_POLL_TIMEOUT_MS ?? 10 * 60 * 1000)
    const intervalMs = Number(process.env.BRIGHT_DATA_SERP_POLL_INTERVAL_MS ?? 5000)
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
        const progress = await getBrightDataSnapshotProgress(String(snapshotId), apiKey)
        console.log(`[seo-serp] snapshot=${snapshotId} status=${progress.status || "unknown"} elapsed=${Math.round((Date.now() - startedAt) / 1000)}s`)
        if (progress.is_ready || isReady(progress.status)) {
            const records = await downloadBrightDataSnapshot(String(snapshotId), apiKey)
            return records.map(record => normalizeRecord(record))
        }
        if (progress.is_failed || isFailed(progress.status)) {
            throw new Error(`Bright Data SERP snapshot failed: ${progress.status || "unknown"}`)
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs))
    }
    throw new Error(`Bright Data SERP snapshot ${snapshotId} timed out after ${timeoutMs}ms.`)
}

function normalizeRecord(record: Record<string, unknown>): BrightDataSerpRecord {
    const organicRaw = Array.isArray(record.organic) ? record.organic : []
    const organic = organicRaw.map(item => {
        const value = item && typeof item === "object" ? item as Record<string, unknown> : {}
        const urlCandidates = [
            value.link,
            value.result_url,
            value.destination_url,
            value.target_url,
            value.organic_url,
            value.href,
            value.url,
        ].filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
        const url = urlCandidates.find(candidate => {
            try {
                return new URL(candidate).hostname !== "www.google.com" && new URL(candidate).hostname !== "google.com"
            } catch {
                return false
            }
        }) ?? urlCandidates[0] ?? ""
        return {
            rank: typeof value.rank === "number" ? value.rank : Number.isFinite(Number(value.rank)) ? Number(value.rank) : null,
            url,
            title: typeof value.title === "string" ? value.title : null,
            description: typeof value.description === "string" ? value.description : typeof value.snippet === "string" ? value.snippet : null,
        }
    }).filter(item => item.url && !isGoogleSearchUrl(item.url))
    const relatedRaw = Array.isArray(record.related) ? record.related : Array.isArray(record.related_queries) ? record.related_queries : []
    const related_queries = relatedRaw.map(item => {
        if (typeof item === "string") return item
        if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") return String((item as Record<string, unknown>).text)
        return ""
    }).filter(Boolean)
    return {
        keyword: typeof record.keyword === "string" ? record.keyword : undefined,
        organic,
        related_queries,
    }
}

function isGoogleSearchUrl(value: string) {
    try {
        const parsed = new URL(value)
        return ["google.com", "www.google.com", "google.co.in", "www.google.co.in"].includes(parsed.hostname) && parsed.pathname === "/search"
    } catch {
        return false
    }
}
