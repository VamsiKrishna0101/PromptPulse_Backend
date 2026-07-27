type TargetPageCandidate = {
    url: string
    title: string | null
    h1: string | null
    detected_services: unknown
    detected_locations: unknown
}

export type OpportunityTargetPage = {
    status: "EXISTING_PAGE" | "NEW_PAGE" | "REVIEW"
    url: string | null
    label: string
    reason: string
}

const STOP_WORDS = new Set([
    "what", "which", "where", "when", "with", "from", "that", "this", "your", "their",
    "best", "good", "should", "choose", "near", "about", "into", "have", "does", "more",
    "hospital", "hospitals", "clinic", "clinics", "company", "companies", "service",
    "services", "provider", "providers", "solution", "solutions",
])

function tokens(value: string) {
    return new Set(
        value
            .toLowerCase()
            .replace(/https?:\/\/|www\./g, " ")
            .replace(/[^a-z0-9]+/g, " ")
            .split(/\s+/)
            .filter(token => token.length >= 4 && !STOP_WORDS.has(token)),
    )
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

export function selectOpportunityTargetPage(input: {
    promptText: string
    topic: string | null
    action: "CREATE" | "REFRESH" | "OPTIMIZE"
    brandUrl: string
    pages: TargetPageCandidate[]
}): OpportunityTargetPage {
    const queryTokens = tokens(`${input.promptText} ${input.topic ?? ""}`)
    const topicTokens = tokens(input.topic ?? "")
    const ranked = input.pages
        .map(page => {
            const pageTokens = tokens([
                page.url,
                page.title ?? "",
                page.h1 ?? "",
                ...stringArray(page.detected_services),
                ...stringArray(page.detected_locations),
            ].join(" "))
            const overlap = [...queryTokens].filter(token => pageTokens.has(token)).length
            const topicOverlap = [...topicTokens].filter(token => pageTokens.has(token)).length
            return { page, overlap, topicOverlap }
        })
        .sort((a, b) => b.topicOverlap - a.topicOverlap || b.overlap - a.overlap)

    const best = ranked[0]
    if (best && (best.topicOverlap >= 1 || best.overlap >= 2)) {
        return {
            status: "EXISTING_PAGE",
            url: best.page.url,
            label: best.page.title || best.page.h1 || best.page.url,
            reason: input.action === "CREATE"
                ? `A relevant owned page already exists (${best.overlap} matching signals), so improve it instead of creating duplicate content.`
                : `Closest owned-page match based on ${best.overlap} shared intent signal${best.overlap === 1 ? "" : "s"}.`,
        }
    }

    if (input.action === "CREATE") {
        return {
            status: "NEW_PAGE",
            url: null,
            label: "New page on your website",
            reason: "The latest site audit did not find a relevant owned page for this missing buyer intent.",
        }
    }

    return {
        status: "REVIEW",
        url: input.brandUrl,
        label: "Review the closest page",
        reason: "The latest site audit did not find a confident page match for this buyer intent.",
    }
}
