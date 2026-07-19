const EXCLUDED_AI_SURFACES = new Set([
    "chatgpt",
    "openai",
    "gemini",
    "googleai",
    "googleaimode",
    "googleaioverview",
    "googleaioverviews",
    "googleaioverviewsmode",
    "googlesearchconsole",
    "perplexity",
    "perplexityai",
    "copilot",
    "microsoftcopilot",
    "bingcopilot",
    "claude",
    "claudeai",
    "deepseek",
    "grok",
    "metaai",
])

const CANONICAL_BRANDS = new Map<string, string>([
    ["ahrefsbrandradar", "Ahrefs"],
    ["brandradar", "Ahrefs"],
    ["semrushaiseo", "Semrush"],
    ["semrushaitoolkit", "Semrush"],
    ["semrushaivisibility", "Semrush"],
    ["peecai", "Peec AI"],
    ["otterlyai", "Otterly AI"],
    ["scrunchai", "Scrunch AI"],
])

export function normalizeBrandEntityKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function sanitizeDiscoveredBrandName(value: string | null | undefined): string | null {
    if (!value) return null

    const cleaned = value
        .replace(/^[\s*_`#|:;-]+|[\s*_`#|:;-]+$/g, "")
        .replace(/\s+(?:in|from)\s+brand\s+gaps?.*$/i, "")
        .replace(/\s+/g, " ")
        .trim()

    if (!cleaned || cleaned.length > 80 || /^https?:\/\//i.test(cleaned)) return null
    if (!/[a-z]/i.test(cleaned) || /^(?:source evidence|brand mentions?|not mentioned|n\/a)$/i.test(cleaned)) return null

    const key = normalizeBrandEntityKey(cleaned)
    if (!key || EXCLUDED_AI_SURFACES.has(key)) return null

    return CANONICAL_BRANDS.get(key) ?? cleaned
}

export function sameBrandEntity(left: string, right: string): boolean {
    const leftName = sanitizeDiscoveredBrandName(left)
    const rightName = sanitizeDiscoveredBrandName(right)
    return Boolean(leftName && rightName && normalizeBrandEntityKey(leftName) === normalizeBrandEntityKey(rightName))
}
