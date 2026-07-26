import type { CrawledSeoPage, SeoIssueInput } from "./seo_types"

export function analyzeTechnicalSeo(pages: CrawledSeoPage[]): SeoIssueInput[] {
    const issues: SeoIssueInput[] = []

    for (const page of pages) {
        if (!page.status_code || page.status_code >= 400) {
            issues.push({
                page_url: page.url,
                category: "TECHNICAL",
                severity: "HIGH",
                title: "Page failed to load",
                description: `${page.url} did not return a healthy HTML response during the SEO audit.`,
                recommendation: "Fix server errors, redirects, or blocking rules so Google and AI crawlers can access this page.",
                priority_score: 92,
            })
            continue
        }
        if (!page.title || page.title.length < 20 || page.title.length > 70) {
            issues.push({
                page_url: page.url,
                category: "TECHNICAL",
                severity: "MEDIUM",
                title: "Title tag needs improvement",
                description: "The page title is missing, too short, or too long for clear search/AI understanding.",
                recommendation: "Write a clear title with brand, service/category, and location where relevant.",
                priority_score: 72,
            })
        }
        if (!page.meta_description || page.meta_description.length < 70 || page.meta_description.length > 170) {
            issues.push({
                page_url: page.url,
                category: "TECHNICAL",
                severity: "MEDIUM",
                title: "Meta description needs improvement",
                description: "The meta description is missing or not strong enough for search snippets.",
                recommendation: "Add a concise description covering service, location, trust proof, and next action.",
                priority_score: 66,
            })
        }
        if (!page.h1) {
            issues.push({
                page_url: page.url,
                category: "TECHNICAL",
                severity: "HIGH",
                title: "Missing H1 heading",
                description: "The page has no primary heading, making the page topic harder to understand.",
                recommendation: "Add one H1 that clearly states the page's service, category, or location intent.",
                priority_score: 82,
            })
        }
        if (!page.indexable) {
            issues.push({
                page_url: page.url,
                category: "TECHNICAL",
                severity: "HIGH",
                title: "Page is marked noindex",
                description: "This page tells search engines not to index it.",
                recommendation: "Remove noindex if this page should appear in Google and AI-sourced answers.",
                priority_score: 95,
            })
        }
        if (!page.has_viewport) {
            issues.push({
                page_url: page.url,
                category: "TECHNICAL",
                severity: "LOW",
                title: "Missing mobile viewport",
                description: "The page may not render correctly on mobile devices.",
                recommendation: "Add a standard viewport meta tag for mobile-friendly rendering.",
                priority_score: 42,
            })
        }
    }

    return issues
}
