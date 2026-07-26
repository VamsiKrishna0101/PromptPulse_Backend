import type { SeoLocalChecklistItem } from "./seo_intelligence_types"

type PageLike = {
    url: string
    title: string | null
    h1: string | null
    page_type: string
    detected_locations: unknown
    detected_services: unknown
    has_schema: boolean
    has_faq: boolean
}

function arrayFromJson(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function hasPage(pages: PageLike[], pattern: RegExp) {
    return pages.some(page => pattern.test(`${page.url} ${page.title ?? ""} ${page.h1 ?? ""}`))
}

export function buildSeoLocalChecklist(input: {
    pages: PageLike[]
    location: string
    industry: string
}): SeoLocalChecklistItem[] {
    const cityTokens = input.location.split(",").map(token => token.trim()).filter(Boolean)
    const locationMentions = input.pages.flatMap(page => arrayFromJson(page.detected_locations))
    const serviceMentions = input.pages.flatMap(page => arrayFromJson(page.detected_services))

    return [
        {
            id: "local-city-coverage",
            label: "City/service coverage",
            status: cityTokens.some(city => locationMentions.some(item => item.toLowerCase() === city.toLowerCase())) ? "PASS" : "NEEDS_WORK",
            reason: "Important pages should mention the served city/locality naturally.",
        },
        {
            id: "local-contact-page",
            label: "Contact/location page",
            status: hasPage(input.pages, /\b(contact|location|directions|appointment)\b/i) ? "PASS" : "NEEDS_WORK",
            reason: "Local SEO needs a clear page with address, phone, directions, and conversion CTA.",
        },
        {
            id: "local-service-pages",
            label: "Service landing pages",
            status: serviceMentions.length >= 3 || input.pages.some(page => page.page_type === "SERVICE") ? "PASS" : "NEEDS_WORK",
            reason: "Each important service should have a page Google and AI systems can map to buyer queries.",
        },
        {
            id: "local-faq",
            label: "FAQ coverage",
            status: input.pages.some(page => page.has_faq) ? "PASS" : "NEEDS_WORK",
            reason: "FAQs help answer long-tail and AI-search questions directly.",
        },
        {
            id: "local-schema",
            label: "Local/schema markup",
            status: input.pages.some(page => page.has_schema) ? "PASS" : "NEEDS_WORK",
            reason: `Add ${/hospital|health|medical/i.test(input.industry) ? "Hospital/MedicalBusiness" : "LocalBusiness"} and FAQ schema where relevant.`,
        },
    ]
}
