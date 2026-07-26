import type { CrawledSeoPage, SeoIssueInput } from "./seo_types"

export function analyzeSchemaSeo(input: {
    pages: CrawledSeoPage[]
    industry: string
}) {
    const issues: SeoIssueInput[] = []
    const hasAnySchema = input.pages.some(page => page.has_schema)
    const hasFaq = input.pages.some(page => page.has_faq)
    const isHealthcare = /\b(hospital|clinic|healthcare|medical|doctor|multispeciality)\b/i.test(input.industry)

    if (!hasAnySchema) {
        issues.push({
            category: "SCHEMA",
            severity: "HIGH",
            title: "Structured data is missing",
            description: "No JSON-LD structured data was found on crawled pages.",
            recommendation: isHealthcare
                ? "Add Organization, WebSite, Hospital/MedicalOrganization, PostalAddress, OpeningHours, and FAQPage schema."
                : "Add Organization, WebSite, LocalBusiness, BreadcrumbList, and FAQPage schema where relevant.",
            priority_score: 86,
        })
    }
    if (!hasFaq) {
        issues.push({
            category: "SCHEMA",
            severity: "MEDIUM",
            title: "FAQ schema opportunity",
            description: "FAQ sections/schema help answer engines map direct buyer questions to your pages.",
            recommendation: "Add FAQPage JSON-LD to high-intent service/location pages using questions from Prompt Intelligence.",
            priority_score: 72,
        })
    }

    return issues
}
