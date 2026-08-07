import { ApifyClient } from "apify-client"
import type { ProviderResult } from "../domain_research/domain_research_types"
import { SeoError } from "../shared/seo_errors"

export type KeywordMatchType = "phrase" | "exact" | "broad" | "related"

export type KeywordResearchRow = {
    keyword: string
    searchVolume: number | null
    cpc: number | null
    keywordDifficulty: number | null
    competition: number | string | null
    intent: string | null
    serpFeatures: string[]
    trend: number[]
}

const DEFAULT_ACTOR_ID = "7LH0CgHLrGbpFh49M"
const MAX_DATASET_ITEMS = 10_000

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
}

function first(source: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null) return source[key]
    }
    return null
}

function nullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function stringList(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value
            .map(item => typeof item === "string" ? item : String(first(record(item), ["name", "type", "feature"]) ?? ""))
            .map(item => item.trim())
            .filter(Boolean)
    }
    if (typeof value !== "string") return []
    return value.split(/[,|;]/).map(item => item.trim()).filter(Boolean)
}

function trendValues(value: unknown): number[] {
    if (!Array.isArray(value)) return []
    return value.map(item => {
        if (typeof item === "number") return item
        const row = record(item)
        return nullableNumber(first(row, ["search_volume", "searchVolume", "volume", "value"])) ?? 0
    }).slice(-12)
}

function keywordValue(source: Record<string, unknown>): string {
    return String(first(source, ["keyword", "phrase", "query", "key"]) ?? "").trim()
}

function normalizeRow(source: Record<string, unknown>): KeywordResearchRow | null {
    const keyword = keywordValue(source)
    if (!keyword) return null
    const metrics = record(first(source, ["metrics", "keyword_metrics", "keywordMetrics"]))
    const merged = { ...source, ...metrics }
    const competitionValue = first(merged, ["competition", "competition_level", "competitionLevel", "com"])
    return {
        keyword,
        searchVolume: nullableNumber(first(merged, ["search_volume", "searchVolume", "volume", "monthly_volume", "monthlyVolume"])),
        cpc: nullableNumber(first(merged, ["cpc", "cost_per_click", "costPerClick"])),
        keywordDifficulty: nullableNumber(first(merged, ["keyword_difficulty", "keywordDifficulty", "difficulty", "kd", "kd_percent"])),
        competition: typeof competitionValue === "string"
            ? competitionValue
            : nullableNumber(competitionValue),
        intent: first(merged, ["search_intent", "searchIntent", "intent"]) == null
            ? null
            : String(first(merged, ["search_intent", "searchIntent", "intent"])),
        serpFeatures: stringList(first(merged, ["serp_features", "serpFeatures", "features"])),
        trend: trendValues(first(merged, ["trend", "trends", "monthly_searches", "monthlySearches", "search_volume_trend", "searchVolumeTrend"])),
    }
}

function collectCandidateRows(items: Record<string, unknown>[]) {
    const candidates: Record<string, unknown>[] = []
    const visit = (value: unknown, depth: number) => {
        if (depth > 3 || candidates.length >= MAX_DATASET_ITEMS) return
        if (Array.isArray(value)) {
            for (const item of value) visit(item, depth + 1)
            return
        }
        const row = record(value)
        if (!Object.keys(row).length) return
        if (keywordValue(row)) candidates.push(row)
        for (const key of ["data", "results", "keywords", "items", "output", "related_keywords", "relatedKeywords"]) {
            if (row[key] !== undefined) visit(row[key], depth + 1)
        }
    }
    visit(items, 0)
    return candidates
}

function normalizeRows(items: Record<string, unknown>[]) {
    const rows: KeywordResearchRow[] = []
    const seen = new Set<string>()
    for (const candidate of collectCandidateRows(items)) {
        const row = normalizeRow(candidate)
        if (!row) continue
        const key = row.keyword.toLocaleLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        rows.push(row)
        if (rows.length >= MAX_DATASET_ITEMS) break
    }
    return rows
}

export async function fetchKeywordResearch(input: {
    query: string
    database: string
    matchType: KeywordMatchType
    pages: number
}): Promise<ProviderResult<Record<string, unknown>>> {
    const token = process.env.APIFY_API_TOKEN?.trim()
    if (!token) {
        throw new SeoError(
            "APIFY_NOT_CONFIGURED",
            "Keyword Research is not configured yet. Add APIFY_API_TOKEN to the backend environment.",
            503,
        )
    }

    const actorId = process.env.APIFY_SEMRUSH_KEYWORD_ACTOR_ID?.trim() || DEFAULT_ACTOR_ID
    const client = new ApifyClient({ token })
    try {
        const run = await client.actor(actorId).call({
            q: input.query,
            db: input.database,
            type: input.matchType,
            pages: input.pages,
        }, { waitSecs: 300 })

        if (run.status !== "SUCCEEDED") {
            throw new SeoError(
                "APIFY_UPSTREAM_ERROR",
                `Keyword dataset did not complete successfully (${run.status}).`,
                502,
                { runId: run.id },
            )
        }

        const dataset = await client
            .dataset<Record<string, unknown>>(run.defaultDatasetId)
            .listItems({ clean: true, limit: MAX_DATASET_ITEMS })
        const keywords = normalizeRows(dataset.items)

        return {
            payload: {
                query: input.query,
                database: input.database,
                matchType: input.matchType,
                pages: input.pages,
                summary: {
                    returnedKeywords: keywords.length,
                    totalSearchVolume: keywords.reduce((sum, row) => sum + (row.searchVolume ?? 0), 0),
                    averageDifficulty: average(keywords.map(row => row.keywordDifficulty)),
                    averageCpc: average(keywords.map(row => row.cpc)),
                },
                keywords,
                source: {
                    provider: "apify",
                    actorId,
                    runId: run.id,
                    datasetId: run.defaultDatasetId,
                },
            },
            costUsd: Number(run.usageTotalUsd ?? 0),
            taskIds: [run.id],
            environment: "production",
            provider: "apify",
        }
    } catch (error) {
        if (error instanceof SeoError) throw error
        const message = error instanceof Error ? error.message : "Unknown Apify error"
        throw new SeoError(
            "APIFY_UPSTREAM_ERROR",
            "Keyword data could not be retrieved from the research provider.",
            502,
            { reason: message },
        )
    }
}

function average(values: (number | null)[]): number | null {
    const usable = values.filter((value): value is number => value !== null)
    if (!usable.length) return null
    return Number((usable.reduce((sum, value) => sum + value, 0) / usable.length).toFixed(2))
}
