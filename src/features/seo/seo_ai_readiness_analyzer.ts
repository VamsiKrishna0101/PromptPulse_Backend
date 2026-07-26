import type { CrawledSeoPage, SeoIssueInput } from "./seo_types"

function anyPageHas(pages: CrawledSeoPage[], pattern: RegExp) {
    return pages.some(page => pattern.test(page.text))
}

export function analyzeAiReadiness(input: {
    pages: CrawledSeoPage[]
    brandName: string
    location: string
    industry: string
}) {
    const issues: SeoIssueInput[] = []
    const home = input.pages[0]
    const brandPattern = new RegExp(input.brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    const locationToken = input.location.split(",")[0]?.trim()
    const locationPattern = locationToken ? new RegExp(locationToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null

    if (home && !brandPattern.test(home.text)) {
        issues.push({
            page_url: home.url,
            category: "AI_READINESS",
            severity: "HIGH",
            title: "Brand entity is not clear on homepage",
            description: "AI systems need repeated, clear brand context to understand who should be recommended.",
            recommendation: "Mention the brand name clearly in hero copy, title, organization schema, and trust sections.",
            priority_score: 88,
        })
    }
    if (locationPattern && !anyPageHas(input.pages, locationPattern)) {
        issues.push({
            category: "AI_READINESS",
            severity: "HIGH",
            title: "Location entity is weak",
            description: `The site does not clearly reinforce ${locationToken}, which weakens local AI recommendations.`,
            recommendation: "Add city/service-area language to homepage, contact page, service pages, footer, and schema.",
            priority_score: 90,
        })
    }
    if (!input.pages.some(page => page.has_faq)) {
        issues.push({
            category: "AI_READINESS",
            severity: "MEDIUM",
            title: "No FAQ-style answer sections found",
            description: "AI answers often reuse direct FAQ-style explanations for buyer questions.",
            recommendation: "Add short FAQs to key service/location pages that answer high-intent prompts directly.",
            priority_score: 76,
        })
    }
    if (!anyPageHas(input.pages, /\b(review|rating|testimonial|case study|patient story|trusted|certified|award|years of experience)\b/i)) {
        issues.push({
            category: "AI_READINESS",
            severity: "MEDIUM",
            title: "Trust proof is thin",
            description: "The website does not strongly expose reviews, credentials, awards, or outcomes.",
            recommendation: "Add trust proof: reviews, doctor credentials, awards, accreditations, case studies, and patient outcomes where compliant.",
            priority_score: 73,
        })
    }
    if (input.pages.filter(page => page.word_count >= 250).length < Math.min(3, input.pages.length)) {
        issues.push({
            category: "AI_READINESS",
            severity: "MEDIUM",
            title: "Content is too thin for AI answers",
            description: "Several crawled pages have little readable content, which limits answer engine understanding.",
            recommendation: "Expand important pages with services, audience, proof, FAQs, location, and clear next steps.",
            priority_score: 70,
        })
    }

    return issues
}
