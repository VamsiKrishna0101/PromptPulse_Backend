import type { CrawledSeoPage, SeoIssueInput } from "./seo_types"

function hasText(pages: CrawledSeoPage[], pattern: RegExp) {
    return pages.some(page => pattern.test(page.text))
}

export function analyzeLocalSeo(input: {
    pages: CrawledSeoPage[]
    location: string
    industry: string
}) {
    const issues: SeoIssueInput[] = []
    const city = input.location.split(",")[0]?.trim()
    const isHealthcare = /\b(hospital|clinic|healthcare|medical|doctor|multispeciality)\b/i.test(input.industry)

    if (city && !hasText(input.pages, new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"))) {
        issues.push({
            category: "LOCAL",
            severity: "HIGH",
            title: "City/local coverage is weak",
            description: `The site does not clearly mention ${city} across key pages.`,
            recommendation: `Add ${city} to homepage copy, service pages, title tags, headings, footer NAP, and LocalBusiness/Hospital schema.`,
            priority_score: 90,
        })
    }
    if (!hasText(input.pages, /\b(address|directions|map|phone|call|contact|hours|open)\b/i)) {
        issues.push({
            category: "LOCAL",
            severity: "HIGH",
            title: "NAP/contact signals are weak",
            description: "Address, phone, hours, directions, or contact signals are not obvious in crawled content.",
            recommendation: "Add consistent Name/Address/Phone, opening hours, map/directions, and emergency contact CTA.",
            priority_score: 88,
        })
    }
    if (!hasText(input.pages, /\b(review|rating|google review|testimonial)\b/i)) {
        issues.push({
            category: "LOCAL",
            severity: "MEDIUM",
            title: "Review signals are weak",
            description: "Local recommendations rely heavily on reviews and reputation proof.",
            recommendation: "Add review snippets, testimonials, Google review CTA, and profile links where allowed.",
            priority_score: 78,
        })
    }
    if (isHealthcare && !hasText(input.pages, /\b(24\/7|emergency|icu|critical care|ambulance)\b/i)) {
        issues.push({
            category: "LOCAL",
            severity: "HIGH",
            title: "Emergency care intent is not covered",
            description: "Hospital buyers often ask AI about emergency, ICU, ambulance, and night-care availability.",
            recommendation: "Create or strengthen an Emergency Care page with 24/7 availability, ICU, ambulance, doctors, location, and FAQs.",
            priority_score: 94,
        })
    }
    if (isHealthcare && !hasText(input.pages, /\b(cashless|insurance|TPA|health insurance|accepted insurance)\b/i)) {
        issues.push({
            category: "LOCAL",
            severity: "MEDIUM",
            title: "Insurance/cashless intent is missing",
            description: "Patients often choose hospitals based on insurance and cashless payment support.",
            recommendation: "Add a Cashless Insurance page listing supported insurers/TPAs, process, documents, and FAQs.",
            priority_score: 84,
        })
    }

    return issues
}
