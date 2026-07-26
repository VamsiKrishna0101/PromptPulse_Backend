import type { SeoCoverageStatus } from "./seo_intelligence_types"

type PageLike = {
    url: string
    title: string | null
    h1: string | null
    word_count: number
    page_type: string
}

const STOP_WORDS = new Set([
    "what", "which", "best", "near", "with", "from", "have", "does", "your", "about",
    "hospital", "clinic", "company", "service", "services", "provider", "tool", "platform",
    "for", "the", "and", "are", "can", "how", "why", "when", "where", "should", "choose",
])

export function normalizeSeoText(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

export function extractSeoTerms(text: string) {
    return normalizeSeoText(text)
        .split(" ")
        .filter(word => word.length > 2 && !STOP_WORDS.has(word))
        .slice(0, 10)
}

export function intentFromTags(tags: string[]) {
    return tags.find(tag => tag.startsWith("intent:"))?.slice("intent:".length).replace(/_/g, " ") ?? "buyer intent"
}

export function funnelFromTags(tags: string[]) {
    return tags.find(tag => tag.startsWith("funnel:"))?.slice("funnel:".length).replace(/_/g, " ") ?? "medium"
}

export function contentTypeForIntent(intent: string) {
    if (/emergency/i.test(intent)) return "Emergency landing page"
    if (/insurance|payment/i.test(intent)) return "Insurance and payment page"
    if (/comparison|alternative/i.test(intent)) return "Comparison page"
    if (/review|trust/i.test(intent)) return "Reviews and trust page"
    if (/service|problem|specialty/i.test(intent)) return "Service landing page"
    return "Buyer-intent landing page"
}

export function mapPromptToPage(promptText: string, pages: PageLike[]) {
    const terms = extractSeoTerms(promptText)
    if (!terms.length || !pages.length) {
        return { page: null, matchScore: 0, coverage: "GAP" as SeoCoverageStatus }
    }

    const scored = pages.map(page => {
        const haystack = normalizeSeoText(`${page.url} ${page.title ?? ""} ${page.h1 ?? ""}`)
        const matched = terms.filter(term => haystack.includes(term)).length
        const score = matched / Math.max(terms.length, 1)
        return { page, score }
    }).sort((a, b) => b.score - a.score)

    const best = scored[0]
    if (!best || best.score < 0.18) return { page: null, matchScore: 0, coverage: "GAP" as SeoCoverageStatus }
    if (best.score < 0.42 || best.page.word_count < 600) return { page: best.page, matchScore: best.score, coverage: "WEAK" as SeoCoverageStatus }
    return { page: best.page, matchScore: best.score, coverage: "COVERED" as SeoCoverageStatus }
}
