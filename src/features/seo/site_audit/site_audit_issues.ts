import type { AuditPage } from "./site_audit_types"
import type { SeoV2IssueCategory, SeoV2IssueSeverity } from "@prisma/client"

export interface DetectedIssue {
    pageUrl: string | null
    category: SeoV2IssueCategory
    severity: SeoV2IssueSeverity
    title: string
    description: string
    recommendation: string
    priority_score: number
}

const TITLE_MAX_CHARS = 60
const TITLE_MIN_CHARS = 10
const META_DESCRIPTION_MAX_CHARS = 160
const META_DESCRIPTION_MIN_CHARS = 70
const THIN_CONTENT_WORDS = 150

export function detectPageIssues(page: AuditPage): DetectedIssue[] {
    const issues: DetectedIssue[] = []

    const addIssue = (
        category: SeoV2IssueCategory,
        severity: SeoV2IssueSeverity,
        title: string,
        description: string,
        recommendation: string,
        priority: number
    ) => {
        issues.push({
            pageUrl: page.url,
            category,
            severity,
            title,
            description,
            recommendation,
            priority_score: priority
        })
    }

    if (page.errorCode === "ROBOTS_BLOCKED") {
        addIssue("ROBOTS", "HIGH", "Blocked by robots.txt", "This page is blocked from being crawled by your robots.txt file.", "Update robots.txt to allow crawling if this page should be indexed.", 80)
        return issues
    }

    if (page.statusCode && page.statusCode >= 500) {
        addIssue("INDEXABILITY", "CRITICAL", "Server Error (5xx)", `The page returned a ${page.statusCode} status code.`, "Investigate your server logs to resolve the issue.", 100)
        return issues
    }
    
    if (page.statusCode && page.statusCode >= 400 && page.statusCode < 500) {
        addIssue("INDEXABILITY", "CRITICAL", "Client Error (4xx)", `The page returned a ${page.statusCode} status code.`, "Ensure the page exists or set up a 301 redirect to an active page.", 100)
        return issues
    }

    if (page.statusCode && page.statusCode >= 300 && page.statusCode < 400) {
        addIssue(
            "REDIRECT",
            "INFO",
            "Redirected URL",
            `The URL redirects${page.redirectChain[0] ? ` to ${page.redirectChain[0]}` : " to another location"}.`,
            "Confirm the redirect is intentional and points directly to the preferred final URL.",
            15,
        )
        return issues
    }

    // HTML metadata, heading, content, image, and schema checks do not apply to
    // PDFs or other non-HTML resources.
    if (!page.isHtml) return issues

    // Titles
    if (!page.title) {
        addIssue("TITLE", "HIGH", "Missing Title Tag", "The page does not have a title tag.", "Add a unique and descriptive <title> tag.", 90)
    } else if (page.title.length > TITLE_MAX_CHARS) {
        addIssue("TITLE", "MEDIUM", "Title Tag Too Long", `The title tag is ${page.title.length} characters (recommended max ${TITLE_MAX_CHARS}).`, "Shorten the title to ensure it displays correctly in search results.", 60)
    } else if (page.title.length < TITLE_MIN_CHARS) {
        addIssue("TITLE", "LOW", "Title Tag Too Short", `The title tag is ${page.title.length} characters (recommended min ${TITLE_MIN_CHARS}).`, "Expand the title to provide more context to search engines.", 40)
    }

    // Meta descriptions
    if (!page.metaDescription) {
        addIssue("META_DESCRIPTION", "HIGH", "Missing Meta Description", "The page does not have a meta description.", "Add a unique meta description.", 85)
    } else if (page.metaDescription.length > META_DESCRIPTION_MAX_CHARS) {
        addIssue("META_DESCRIPTION", "MEDIUM", "Meta Description Too Long", `The meta description is ${page.metaDescription.length} characters (recommended max ${META_DESCRIPTION_MAX_CHARS}).`, "Shorten the meta description.", 55)
    } else if (page.metaDescription.length < META_DESCRIPTION_MIN_CHARS) {
        addIssue("META_DESCRIPTION", "LOW", "Meta Description Too Short", `The meta description is ${page.metaDescription.length} characters (recommended min ${META_DESCRIPTION_MIN_CHARS}).`, "Expand the meta description to encourage more click-throughs.", 35)
    }

    // Headings
    if (page.h1Count === 0) {
        addIssue("HEADINGS", "HIGH", "Missing H1 Tag", "The page does not have an H1 tag.", "Add exactly one descriptive H1 tag to the page.", 80)
    } else if (page.h1Count > 1) {
        addIssue("HEADINGS", "MEDIUM", "Multiple H1 Tags", `The page has ${page.h1Count} H1 tags.`, "Ensure there is only one H1 tag per page.", 50)
    }

    // Content Quality
    if (page.indexable && page.wordCount < THIN_CONTENT_WORDS) {
        addIssue("INDEXABILITY", "HIGH", "Thin Content", `The page only has ${page.wordCount} words of content.`, "Add more valuable content to the page.", 75)
    }

    // Images
    if (page.imagesMissingAlt > 0) {
        addIssue("IMAGES", "MEDIUM", "Missing Image Alt Attributes", `${page.imagesMissingAlt} images are missing alt attributes.`, "Add descriptive alt attributes to all images.", 60)
    }

    // Indexability & Canonical
    if (page.noindex) {
        addIssue("INDEXABILITY", "INFO", "Noindex Tag Detected", "The page has a noindex tag and will not appear in search results.", "Ensure this is intentional.", 20)
    }
    
    if (page.canonicalUrl && !page.canonicalIsSelf) {
        addIssue("CANONICAL", "INFO", "Canonicalized to Another Page", `The page canonicalizes to ${page.canonicalUrl}.`, "Ensure this is intentional.", 20)
    }

    return issues
}

export function detectMultiPageIssues(pages: AuditPage[]): DetectedIssue[] {
    const issues: DetectedIssue[] = []

    // Map all valid URLs
    const validUrls = new Set(pages.filter(p => p.statusCode && p.statusCode < 400).map(p => p.url))

    // 1. Broken Internal Links
    for (const page of pages) {
        for (const link of page.internalLinks) {
            if (!validUrls.has(link) && pages.some(p => p.url === link && p.statusCode && p.statusCode >= 400)) {
                issues.push({
                    pageUrl: page.url,
                    category: "LINKS",
                    severity: "HIGH",
                    title: "Broken Internal Link",
                    description: `The page links to a broken URL: ${link}.`,
                    recommendation: "Remove or update the broken link.",
                    priority_score: 85
                })
            }
        }
    }

    // 2. Orphan Pages
    // Create a set of all URLs that are linked *from* other pages
    const linkedUrls = new Set<string>()
    for (const page of pages) {
        for (const link of page.internalLinks) {
            if (link !== page.url) { // ignore self-links
                linkedUrls.add(link)
            }
        }
    }

    // An orphan is a valid page (200 OK) that has no internal incoming links
    // Assuming pages[0] is the start URL, which is never an orphan by definition
    const startUrl = pages[0]?.url
    for (const page of pages) {
        if (page.url !== startUrl && page.statusCode && page.statusCode >= 200 && page.statusCode < 300) {
            if (!linkedUrls.has(page.url)) {
                issues.push({
                    pageUrl: page.url,
                    category: "ORPHAN_PAGES",
                    severity: "HIGH",
                    title: "Orphan Page",
                    description: "This page has no incoming internal links.",
                    recommendation: "Link to this page from other relevant pages on your site.",
                    priority_score: 70
                })
            }
        }
    }

    return issues
}
