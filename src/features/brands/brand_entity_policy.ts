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

const NON_COMPETITOR_ENTITY_KEYS = new Set([
    "justdial",
    "practo",
    "sulekha",
    "indiamart",
    "yelp",
    "tripadvisor",
    "trustpilot",
    "glassdoor",
    "g2",
    "capterra",
    "clutch",
    "goodfirms",
    "wikipedia",
    "reddit",
    "linkedin",
    "youtube",
    "amazon",
    "flipkart",
    "timesofindia",
    "thetimesofindia",
])

const NON_COMPETITOR_DOMAINS = new Set([
    "justdial.com",
    "practo.com",
    "sulekha.com",
    "indiamart.com",
    "yelp.com",
    "tripadvisor.com",
    "trustpilot.com",
    "glassdoor.com",
    "g2.com",
    "capterra.com",
    "clutch.co",
    "goodfirms.co",
    "wikipedia.org",
    "reddit.com",
    "linkedin.com",
    "youtube.com",
    "amazon.com",
    "amazon.in",
    "flipkart.com",
    "timesofindia.indiatimes.com",
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

export function normalizeEntityDomain(value: string | null | undefined): string | null {
    if (!value) return null
    try {
        const hostname = new URL(value.includes("://") ? value : `https://${value}`).hostname
        return hostname.toLowerCase().replace(/^www\./, "")
    } catch {
        return value.toLowerCase().replace(/^www\./, "").split("/")[0] || null
    }
}

export function isEligibleCompetitorEntity(input: {
    name: string | null | undefined
    domain?: string | null
    ownBrandName?: string | null
    ownBrandUrl?: string | null
}) {
    const name = sanitizeDiscoveredBrandName(input.name)
    if (!name) return false
    if (input.ownBrandName && sameBrandEntity(name, input.ownBrandName)) return false

    const key = normalizeBrandEntityKey(name)
    const domain = normalizeEntityDomain(input.domain)
    const ownDomain = normalizeEntityDomain(input.ownBrandUrl)
    if (NON_COMPETITOR_ENTITY_KEYS.has(key)) return false
    if (domain && NON_COMPETITOR_DOMAINS.has(domain)) return false
    if (domain && ownDomain && domain === ownDomain) return false
    return true
}

export function sameBrandEntity(left: string, right: string): boolean {
    const leftName = sanitizeDiscoveredBrandName(left)
    const rightName = sanitizeDiscoveredBrandName(right)
    if (!leftName || !rightName) return false
    if (normalizeBrandEntityKey(leftName) === normalizeBrandEntityKey(rightName)) return true

    const comparable = (value: string) => value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .filter(token => ![
            "hospital", "hospitals", "health", "healthcare", "clinic", "clinics",
            "medical", "centre", "center", "group", "limited", "ltd", "private", "pvt",
            "speciality", "specialty", "superspeciality", "superspecialty", "multispeciality",
            "multispecialty", "multi", "super",
        ].includes(token))
        .join("")

    const leftComparable = comparable(leftName)
    const rightComparable = comparable(rightName)
    if (!leftComparable || !rightComparable) return false
    if (leftComparable === rightComparable) return true

    const shorter = leftComparable.length <= rightComparable.length ? leftComparable : rightComparable
    const longer = shorter === leftComparable ? rightComparable : leftComparable
    return shorter.length >= 6 && longer.startsWith(shorter)
}
