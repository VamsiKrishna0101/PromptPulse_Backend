type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as JsonRecord
        : {}
}

function rows(value: unknown): JsonRecord[] {
    return Array.isArray(value) ? value.map(record) : []
}

function numberOrNull(value: unknown): number | null {
    if (value == null || value === "") return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeIntent(value: unknown) {
    const raw = text(value)?.toLowerCase() ?? ""
    if (raw.includes("inform")) return "informational"
    if (raw.includes("navig")) return "navigational"
    if (raw.includes("commerc")) return "commercial"
    if (raw.includes("transact")) return "transactional"
    return "unknown"
}

function unwrapItems(result: JsonRecord | null, source: string) {
    const items = rows(result?.items)
    return source === "related"
        ? items.map(item => record(item.keyword_data))
        : items
}

export function mapKeywordRows(
    result: JsonRecord | null,
    source: "related" | "suggestions" | "ideas",
) {
    const seen = new Set<string>()
    return unwrapItems(result, source).flatMap(item => {
        const keyword = text(item.keyword)?.toLowerCase()
        if (!keyword || seen.has(keyword)) return []
        seen.add(keyword)
        const clickstream = record(item.keyword_info_normalized_with_clickstream)
        const standard = record(item.keyword_info)
        const info = clickstream.search_volume != null ? clickstream : standard
        const properties = record(item.keyword_properties)
        const intent = record(item.search_intent_info)
        return [{
            keyword,
            searchVolume: numberOrNull(info.search_volume),
            cpcUsd: numberOrNull(standard.cpc),
            competition: numberOrNull(standard.competition),
            competitionLevel: text(standard.competition_level)?.toUpperCase() ?? null,
            keywordDifficulty: numberOrNull(properties.keyword_difficulty),
            intent: normalizeIntent(intent.main_intent),
            trend: rows(info.monthly_searches).map(entry => ({
                year: Number(entry.year ?? 0),
                month: Number(entry.month ?? 0),
                searchVolume: Number(entry.search_volume ?? 0),
            })).filter(entry => entry.year > 0 && entry.month >= 1 && entry.month <= 12),
        }]
    })
}
