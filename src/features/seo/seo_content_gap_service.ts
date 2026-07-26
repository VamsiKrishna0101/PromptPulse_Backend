import type { CrawledSeoPage, SeoActionInput, SeoIssueInput } from "./seo_types"

function normalize(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

function intentFromTags(tags: string[]) {
    return tags.find(tag => tag.startsWith("intent:"))?.slice("intent:".length) ?? null
}

function keyTerms(promptText: string) {
    const stop = new Set(["which", "what", "best", "hospital", "clinic", "provider", "company", "should", "choose", "near", "with", "good", "the", "and", "for", "in", "is", "are", "my"])
    return normalize(promptText)
        .split(" ")
        .filter(word => word.length > 3 && !stop.has(word))
        .slice(0, 8)
}

function pageMatchesPrompt(page: CrawledSeoPage, promptText: string) {
    const terms = keyTerms(promptText)
    if (!terms.length) return false
    const text = normalize(`${page.url} ${page.title ?? ""} ${page.h1 ?? ""} ${page.text}`)
    const matched = terms.filter(term => text.includes(term)).length
    return matched >= Math.min(3, Math.ceil(terms.length * 0.45))
}

function contentTypeForIntent(intent: string | null) {
    if (intent === "emergency") return "Emergency/location page"
    if (intent === "insurance_payment") return "Insurance/payment page"
    if (intent === "comparison") return "Comparison page"
    if (intent === "trust_reviews") return "Trust/reviews page section"
    if (intent === "service_specific" || intent === "problem_led") return "Service page"
    return "Buyer-intent landing page"
}

export async function buildSeoContentGaps(input: {
    pages: CrawledSeoPage[]
    prompts: { id: string; text: string; tags: string[]; priority_score: number | null; topic: string }[]
}) {
    const issues: SeoIssueInput[] = []
    const actions: SeoActionInput[] = []
    const highValuePrompts = input.prompts
        .filter(prompt => (prompt.priority_score ?? 0) >= 75 || prompt.tags.some(tag => tag === "funnel:high"))
        .slice(0, 20)

    for (const prompt of highValuePrompts) {
        if (input.pages.some(page => pageMatchesPrompt(page, prompt.text))) continue

        const intent = intentFromTags(prompt.tags)
        const contentType = contentTypeForIntent(intent)
        const terms = keyTerms(prompt.text).slice(0, 4).join(", ")
        issues.push({
            category: "CONTENT",
            severity: "HIGH",
            title: `Missing page for: ${prompt.topic}`,
            description: `No crawled page clearly answers the high-value prompt: "${prompt.text}".`,
            recommendation: `Create or improve a ${contentType.toLowerCase()} covering: ${terms}. Add FAQs, proof, location/service language, and schema.`,
            priority_score: Math.min(96, Math.round((prompt.priority_score ?? 75) + 6)),
        })
        actions.push({
            action_type: "CREATE_OR_OPTIMIZE_PAGE",
            title: `Build page for "${prompt.text}"`,
            description: `Create or improve a ${contentType} so Google and AI answers can confidently map this buyer question to your brand.`,
            priority: "HIGH",
            difficulty: contentType.includes("section") ? "LOW" : "MEDIUM",
            related_prompt_ids: [prompt.id],
        })
    }

    return { issues, actions }
}
