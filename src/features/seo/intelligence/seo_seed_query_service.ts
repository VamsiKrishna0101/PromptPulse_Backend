type PageLike = {
    url: string
    title: string | null
    h1: string | null
    page_type: string
    detected_services: unknown
}

type SeedPrompt = {
    id: string
    text: string
    topic: string
    tags: string[]
    priority_score: number | null
    chats: { brand_mentioned: boolean; brand_position: number | null }[]
}

function arrayFromJson(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function cleanLocation(location: string) {
    return location.split(",").map(part => part.trim()).filter(Boolean)[0] ?? location.trim()
}

function readableService(value: string) {
    return value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
}

function servicesFromPages(pages: PageLike[]) {
    const detected = pages.flatMap(page => arrayFromJson(page.detected_services)).map(readableService)
    const fromUrls = pages
        .filter(page => page.page_type === "SERVICE")
        .map(page => page.h1 ?? page.title ?? page.url.split("/").pop() ?? "")
        .map(readableService)
    return [...new Set([...detected, ...fromUrls].filter(Boolean))].slice(0, 6)
}

export function buildSeedSeoQueries(input: {
    brandName: string
    location: string
    industry: string
    pages: PageLike[]
}): SeedPrompt[] {
    const city = cleanLocation(input.location)
    const industry = input.industry || "service provider"
    const services = servicesFromPages(input.pages)
    const baseQueries = [
        {
            text: `Best ${industry} in ${city}`,
            topic: "Best local provider",
            tags: ["intent:local_best", "funnel:high", "source:seo_seed"],
            priority_score: 88,
        },
        {
            text: `${input.brandName} reviews and reputation`,
            topic: "Reviews and trust",
            tags: ["intent:trust_reviews", "funnel:high", "source:seo_seed"],
            priority_score: 84,
        },
        {
            text: `${industry} near me in ${city}`,
            topic: "Near me search",
            tags: ["intent:near_me", "funnel:high", "source:seo_seed"],
            priority_score: 82,
        },
        {
            text: `${input.brandName} pricing, services, and contact details`,
            topic: "Commercial information",
            tags: ["intent:pricing_contact", "funnel:medium", "source:seo_seed"],
            priority_score: 76,
        },
    ]

    const serviceQueries = services.flatMap(service => [
        {
            text: `Best ${service} in ${city}`,
            topic: service,
            tags: ["intent:service_specific", "funnel:high", "source:seo_seed"],
            priority_score: 86,
        },
        {
            text: `${service} cost, appointment, and reviews in ${city}`,
            topic: `${service} conversion`,
            tags: ["intent:service_conversion", "funnel:high", "source:seo_seed"],
            priority_score: 80,
        },
    ])

    return [...baseQueries, ...serviceQueries].slice(0, 16).map((query, index) => ({
        id: `seo-seed-${index + 1}`,
        ...query,
        chats: [],
    }))
}
