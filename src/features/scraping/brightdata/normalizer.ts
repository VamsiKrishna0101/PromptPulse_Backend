import type { BrightDataRecord, UiCitation, UiEngine, UiScrapeResult } from "./types"
import { arrayFrom, isRecord, readNumber, readString, safeJsonStringify } from "./utils"

export function normalizeBrightDataRecord(engine: UiEngine, prompt: string, record: BrightDataRecord): UiScrapeResult {
    const errorText = readString(record, ["error", "warning", "message"])
    const rawAnswer = compactUnique([
        chooseAnswerText(record),
        readString(record, ["additional_answer_text"]),
    ].map(repairMojibake)).join("\n\n").trim()

    const citations = extractCitations(record)
    const answer = cleanAnswerText(engine, rawAnswer, citations)

    if (!answer && errorText) {
        throw new Error(`Bright Data record error: ${errorText}`)
    }

    const model = readString(record, ["model", "model_name", "ai_model"]) ?? "ai-search"

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
    const candidates: Array<{ value: unknown, source_kind: NonNullable<UiCitation["source_kind"]>, default_cited: boolean }> = [
        ...arrayFrom(record.citations).map(value => ({ value, source_kind: "citation" as const, default_cited: true })),
        ...arrayFrom(record.links_attached).map(value => ({ value, source_kind: "attached_link" as const, default_cited: true })),
        ...arrayFrom(record.search_sources).map(value => ({ value, source_kind: "search_source" as const, default_cited: false })),
        ...arrayFrom(record.search_sources_more).map(value => ({ value, source_kind: "search_source_more" as const, default_cited: false })),
        ...arrayFrom(record.sources).map(value => ({ value, source_kind: "source" as const, default_cited: false })),
        ...arrayFrom(record.references).map(value => ({ value, source_kind: "reference" as const, default_cited: false })),
    ]

    const seen = new Set<string>()
    const citations: UiCitation[] = []
    const maxSources = Math.max(1, Number(process.env.BRIGHT_DATA_MAX_SOURCES_PER_RECORD ?? 32))

    for (const candidate of candidates) {
        if (!isRecord(candidate.value)) continue
        const url = readString(candidate.value, ["url", "link", "href"])
        const text = repairMojibake(readString(candidate.value, ["title", "text", "name", "domain"])) ?? url
        if (!url && !text) continue

        const key = normalizeSourceKey(url ?? text ?? "")
        if (seen.has(key)) continue
        seen.add(key)

        const explicitCited = candidate.value.cited
        citations.push({
            text: text ?? url ?? "Source",
            url: url ?? "",
            domain: normalizeCitationDomain(repairMojibake(readString(candidate.value, ["domain"])) ?? url),
            snippet: repairMojibake(readString(candidate.value, ["snippet", "description"])),
            position: readNumber(candidate.value, ["position", "rank"]),
            answer_position: readNumber(candidate.value, ["answer_position"]),
            is_cited: typeof explicitCited === "boolean" ? explicitCited : candidate.default_cited,
            source_kind: candidate.source_kind,
        })

        if (citations.length >= maxSources) break
    }

    return citations
}

function chooseAnswerText(record: BrightDataRecord) {
    const markdownAnswer = readString(record, ["answer_text_markdown", "answer_markdown", "exported_markdown"])
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

function cleanAnswerText(engine: UiEngine, answer: string, citations: UiCitation[]) {
    const cleaned = (engine === "copilot" ? removeInlineSourceArtifacts(answer, citations) : answer)
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+\n/g, "\n")
        .trim()

    if (engine !== "copilot") return cleaned

    return cleaned
        .replace(/(\*\*|[.!?])([💳🔑⚠️✅📌])/g, "$1\n\n$2")
        .replace(/([.!?])(\*\s+\*\*)/g, "$1\n\n$2")
        .replace(/\*\*([.!?])([A-Z])/g, "**$1\n\n$2")
        .replace(/([.!?])([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}\s*-{2,})/g, "$1\n\n$2")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

function removeInlineSourceArtifacts(answer: string, citations: UiCitation[]) {
    if (!answer || citations.length === 0) return answer

    let cleaned = answer
    const sourceLabels = citations
        .flatMap(citation => [citation.domain, citation.text])
        .filter((value): value is string => Boolean(value?.trim()))
        .map(value => value.trim())
        .filter(value => value.length >= 4 && value.length <= 120)
        .sort((a, b) => b.length - a.length)

    for (const label of sourceLabels) {
        const escaped = escapeRegExp(label)
        if (looksLikeDomain(label)) {
            const domain = normalizeCitationDomain(label) ?? label
            const domainPattern = escapeRegExp(domain)
            cleaned = cleaned
                .replace(new RegExp(`(?:https?:\\/\\/)?(?:www\\.)?${domainPattern}(?:\\+\\d+)?\\.?\\s*`, "gi"), "")
        } else {
            cleaned = cleaned
                .split(label).join(" ")
                .replace(new RegExp(`(?:^|\\s)${escaped}(?=(?:\\s|$|[.!?,;:]))`, "g"), " ")
        }
    }

    return cleaned
        .replace(/\+\d+/g, "")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/([.!?]){2,}/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n[ \t]+/g, "\n")
        .trim()
}

function looksLikeDomain(value: string) {
    return /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/)?$/i.test(value.trim())
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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

function normalizeSourceKey(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/[?#].*$/, "")
        .replace(/\/$/, "")
}

function normalizeCitationDomain(value: string | undefined) {
    if (!value) return undefined
    const trimmed = value.trim()
    try {
        return new URL(trimmed).hostname.replace(/^www\./, "")
    } catch {
        return trimmed
            .replace(/^https?:\/\//i, "")
            .replace(/^www\./i, "")
            .replace(/\/.*$/, "")
            .trim() || undefined
    }
}

function looksLikeHtml(value: string) {
    return /<\/?[a-z][\s\S]*>/i.test(value)
}

function stripHtml(value: string) {
    return repairMojibake(value
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
        .trim()) ?? ""
}

function repairMojibake(value: string | undefined) {
    if (!value) return undefined
    if (!looksMojibaked(value)) return value

    try {
        const repaired = Buffer.from(value, "latin1").toString("utf8")
        return mojibakeScore(repaired) < mojibakeScore(value) ? repaired : value
    } catch {
        return value
    }
}

function looksMojibaked(value: string) {
    return mojibakeScore(value) >= 2
}

function mojibakeScore(value: string) {
    const matches = value.match(/Ã.|Â.|Æ.|áº|á»|Ä.|â€™|â€œ|â€|ðŸ/g)
    return matches?.length ?? 0
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
