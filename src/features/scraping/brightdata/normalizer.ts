import type { BrightDataRecord, UiCitation, UiEngine, UiScrapeResult } from "./types"
import { arrayFrom, isRecord, readString, safeJsonStringify } from "./utils"

export function normalizeBrightDataRecord(engine: UiEngine, prompt: string, record: BrightDataRecord): UiScrapeResult {
    const errorText = readString(record, ["error", "warning", "message"])
    const answer = compactUnique([
        chooseAnswerText(record),
        readString(record, ["additional_answer_text"]),
    ]).join("\n\n").trim()

    if (!answer && errorText) {
        throw new Error(`Bright Data record error: ${errorText}`)
    }

    const model = readString(record, ["model", "model_name", "ai_model"]) ?? "ai-search"
    const citations = extractCitations(record)

    return {
        engine,
        prompt,
        status: answer ? "success" : "failed",
        answer_text: answer || null,
        citations,
        screenshot_path: null,
        model_label: `${engine}-brightdata-${model}`,
        error_reason: answer ? null : (errorText ?? "Bright Data returned an empty answer."),
        raw_text: safeJsonStringify(record),
        retry_count: 0,
        created_at: new Date().toISOString(),
    }
}

export function extractRecords(data: unknown): BrightDataRecord[] {
    if (typeof data === "string") {
        return parseStringRecords(data)
    }

    if (Array.isArray(data)) {
        return data.filter(isRecord)
    }

    if (isRecord(data)) {
        if (Array.isArray(data.data)) return data.data.filter(isRecord)
        if (Array.isArray(data.results)) return data.results.filter(isRecord)
        if (Array.isArray(data.records)) return data.records.filter(isRecord)
        if (!hasSnapshotId(data)) return [data]
    }

    return []
}

function parseStringRecords(value: string): BrightDataRecord[] {
    const trimmed = value.trim()
    if (!trimmed) return []

    try {
        return extractRecords(JSON.parse(trimmed))
    } catch {
        return trimmed
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .flatMap(line => {
                try {
                    const parsed = JSON.parse(line)
                    return isRecord(parsed) ? [parsed] : []
                } catch {
                    return []
                }
            })
    }
}

function hasSnapshotId(value: unknown) {
    return Boolean(
        value
        && typeof value === "object"
        && "snapshot_id" in value
        && typeof (value as { snapshot_id?: unknown }).snapshot_id === "string"
    )
}

function extractCitations(record: BrightDataRecord): UiCitation[] {
    const candidates = [
        ...arrayFrom(record.citations),
        ...arrayFrom(record.search_sources),
        ...arrayFrom(record.search_sources_more),
        ...arrayFrom(record.sources),
        ...arrayFrom(record.links_attached),
        ...arrayFrom(record.references),
    ]

    const seen = new Set<string>()
    const citations: UiCitation[] = []

    for (const candidate of candidates) {
        if (!isRecord(candidate)) continue
        const url = readString(candidate, ["url", "link", "href"])
        const text = readString(candidate, ["title", "text", "name", "domain"]) ?? url
        if (!url && !text) continue

        const key = `${url ?? ""}|${text ?? ""}`.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)

        citations.push({
            text: text ?? url ?? "Source",
            url: url ?? "",
        })
    }

    return citations
}

function chooseAnswerText(record: BrightDataRecord) {
    const markdownAnswer = readString(record, ["answer_text_markdown", "answer_markdown"])
    const plainAnswer = readString(record, [
        "answer_text",
        "answer",
        "response",
        "content",
        "text",
        "answer_html",
        "markdown",
        "markdown_text",
        "output",
        "result",
    ])
    const nestedAnswer = findNestedAnswerText(record)

    if (markdownAnswer && !looksLikeHtml(markdownAnswer)) return markdownAnswer
    if (plainAnswer && !looksLikeHtml(plainAnswer)) return plainAnswer
    if (plainAnswer && looksLikeHtml(plainAnswer)) return stripHtml(plainAnswer)
    if (markdownAnswer) return stripHtml(markdownAnswer)
    if (nestedAnswer && looksLikeHtml(nestedAnswer)) return stripHtml(nestedAnswer)
    if (nestedAnswer) return nestedAnswer

    return undefined
}

const ANSWER_FIELD_HINTS = [
    "answer",
    "answer_text",
    "answer_markdown",
    "markdown",
    "markdown_text",
    "response",
    "content",
    "output",
    "result",
    "text",
]

function findNestedAnswerText(value: unknown, depth = 0): string | undefined {
    if (depth > 4 || !isRecord(value) && !Array.isArray(value)) return undefined

    const candidates: string[] = []

    if (Array.isArray(value)) {
        for (const item of value) {
            const nested = findNestedAnswerText(item, depth + 1)
            if (nested) candidates.push(nested)
        }
    } else {
        for (const [key, fieldValue] of Object.entries(value)) {
            const normalizedKey = key.toLowerCase()
            if (typeof fieldValue === "string" && ANSWER_FIELD_HINTS.some(hint => normalizedKey.includes(hint))) {
                const cleaned = fieldValue.trim()
                if (cleaned.length >= 80 && !looksLikeUrlOnly(cleaned)) {
                    candidates.push(cleaned)
                }
            }

            if (isRecord(fieldValue) || Array.isArray(fieldValue)) {
                const nested = findNestedAnswerText(fieldValue, depth + 1)
                if (nested) candidates.push(nested)
            }
        }
    }

    return candidates.sort((a, b) => b.length - a.length)[0]
}

function looksLikeUrlOnly(value: string) {
    return /^https?:\/\/\S+$/i.test(value.trim())
}

function looksLikeHtml(value: string) {
    return /<\/?[a-z][\s\S]*>/i.test(value)
}

function stripHtml(value: string) {
    return value
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
}

function compactUnique(values: Array<string | undefined>) {
    const seen = new Set<string>()
    const compacted: string[] = []

    for (const value of values) {
        const trimmed = value?.trim()
        if (!trimmed) continue
        const key = trimmed.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        compacted.push(trimmed)
    }

    return compacted
}
