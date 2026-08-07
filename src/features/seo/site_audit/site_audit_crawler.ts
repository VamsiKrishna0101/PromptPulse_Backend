import prisma from "../../../lib/prisma"
import { fetchAndAnalyzePage } from "./site_audit_analyzer"
import { isAllowedByRobotsTxt, normalizeAuditUrl, sameOrigin } from "./site_audit_url_policy"
import type { AuditPage, CrawlResult } from "./site_audit_types"
import { fetchLighthouseScores } from "./site_audit_lighthouse"
import { detectPageIssues, detectMultiPageIssues, type DetectedIssue } from "./site_audit_issues"
const CONCURRENCY = 5
const CRAWL_DELAY_MS = 500

async function fetchRobotsTxt(origin: string): Promise<{ url: string; raw: string | null }> {
    const url = `${origin}/robots.txt`
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (response.ok) {
            return { url, raw: await response.text() }
        }
    } catch {
        // Ignore errors fetching robots.txt
    }
    return { url, raw: null }
}

export async function runCrawl(
    auditId: string,
    startUrl: string,
    maxPages: number
): Promise<void> {
    try {
        const origin = new URL(startUrl).origin
        const robots = await fetchRobotsTxt(origin)
        
        const frontier: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }]
        const visited = new Set<string>()
        const pages: AuditPage[] = []
        let activeRequests = 0

        while ((frontier.length > 0 || activeRequests > 0) && pages.length < maxPages) {
            if (activeRequests >= CONCURRENCY || frontier.length === 0) {
                await new Promise(resolve => setTimeout(resolve, CRAWL_DELAY_MS))
                continue
            }

            const next = frontier.shift()!
            if (visited.has(next.url)) continue
            visited.add(next.url)

            if (!isAllowedByRobotsTxt(next.url, robots.raw, "PromptPulse-SEO-Audit")) {
                const blockedPage: AuditPage = {
                    url: next.url,
                    statusCode: null,
                    contentType: null,
                    isHtml: false,
                    errorCode: "ROBOTS_BLOCKED",
                    redirectChain: [],
                    crawlDepth: next.depth,
                    inboundLinksCount: 0,
                    isOrphan: next.depth > 0,
                    indexable: false,
                    robotsBlocked: true,
                    noindex: false,
                    canonicalIsSelf: true,
                    canonicalUrl: null,
                    title: null,
                    metaDescription: null,
                    h1: null,
                    h1Count: 0,
                    h2Count: 0,
                    wordCount: 0,
                    contentHash: null,
                    hasViewport: false,
                    hasSchema: false,
                    schemaTypes: [],
                    imagesTotal: 0,
                    imagesMissingAlt: 0,
                    internalLinks: [],
                    externalLinks: 0,
                    pageSizeBytes: null,
                    responseTimeMs: null,
                }
                pages.push(blockedPage)
                continue
            }

            activeRequests++
            fetchAndAnalyzePage({ url: next.url, origin, depth: next.depth }).then(page => {
                pages.push(page)
                
                if (page.crawlDepth < 10) {
                    for (const target of page.redirectChain) {
                        if (sameOrigin(target, origin) && !visited.has(target)) {
                            frontier.push({ url: target, depth: page.crawlDepth })
                        }
                    }
                    for (const link of page.internalLinks) {
                        if (!visited.has(link)) {
                            frontier.push({ url: link, depth: page.crawlDepth + 1 })
                        }
                    }
                }
                activeRequests--
            }).catch(() => {
                activeRequests--
            })
        }

        // Wait for remaining requests
        while (activeRequests > 0) {
            await new Promise(resolve => setTimeout(resolve, 100))
        }

        // Fetch Lighthouse scores for the homepage
        const lighthouseScores = await fetchLighthouseScores(startUrl)

        // Detect Issues
        let allIssues: DetectedIssue[] = []
        for (const page of pages) {
            allIssues.push(...detectPageIssues(page))
        }
        allIssues.push(...detectMultiPageIssues(pages))

        // Persist pages to Prisma
        const pageIdMap = new Map<string, string>() // URL -> DB UUID
        for (const page of pages) {
            const dbPage = await prisma.seoAuditPage.create({
                data: {
                    audit_id: auditId,
                    url: page.url,
                    status_code: page.statusCode,
                    title: page.title,
                    meta_description: page.metaDescription,
                    h1: page.h1,
                    canonical: page.canonicalUrl,
                    word_count: page.wordCount,
                    indexable: page.indexable,
                    has_viewport: page.hasViewport,
                    has_schema: page.hasSchema,
                    detected_services: [],
                    detected_locations: [],
                    page_type: "OTHER",
                }
            })
            pageIdMap.set(page.url, dbPage.id)
        }

        // Persist issues to Prisma
        for (const issue of allIssues) {
            await prisma.seoIssue.create({
                data: {
                    audit_id: auditId,
                    page_id: issue.pageUrl ? pageIdMap.get(issue.pageUrl) : null,
                    category: issue.category,
                    severity: issue.severity,
                    title: issue.title,
                    description: issue.description,
                    recommendation: issue.recommendation,
                    priority_score: issue.priority_score
                }
            })
        }

        const finalScore = calculateHealthScore(pages, allIssues, lighthouseScores.seo)

        // Mark audit as completed
        await prisma.seoAudit.update({
            where: { id: auditId },
            data: { 
                status: "COMPLETED", 
                overall_score: finalScore, 
                technical_score: lighthouseScores.performance ?? 0,
                content_score: lighthouseScores.bestPractices ?? 0,
            }
        })

    } catch (error) {
        console.error(`Audit ${auditId} failed:`, error)
        await prisma.seoAudit.update({
            where: { id: auditId },
            data: { 
                status: "FAILED", 
                error_reason: error instanceof Error ? error.message : "Unknown error during crawl" 
            }
        })
        throw error
    }
}

function calculateHealthScore(
    pages: AuditPage[],
    issues: DetectedIssue[],
    lighthouseSeo: number | null,
) {
    const eligiblePages = Math.max(1, pages.filter(page =>
        page.isHtml && page.statusCode != null && page.statusCode >= 200 && page.statusCode < 300,
    ).length)
    const groups = new Map<string, { severity: string; category: string; urls: Set<string> }>()
    for (const issue of issues) {
        if (issue.severity === "INFO") continue
        const key = `${issue.category}:${issue.title}`
        const group = groups.get(key) ?? {
            severity: issue.severity,
            category: issue.category,
            urls: new Set<string>(),
        }
        if (issue.pageUrl) group.urls.add(issue.pageUrl)
        groups.set(key, group)
    }

    const bucketPenalties = new Map<string, number>()
    for (const group of groups.values()) {
        const coverage = group.urls.size ? Math.min(1, group.urls.size / eligiblePages) : 1
        const weight = group.severity === "CRITICAL" ? 28
            : group.severity === "HIGH" ? 15
                : group.severity === "MEDIUM" ? 7
                    : 2
        const penalty = weight * (.25 + .75 * Math.sqrt(coverage))
        const bucket = scoreBucket(group.category)
        bucketPenalties.set(bucket, (bucketPenalties.get(bucket) ?? 0) + penalty)
    }

    const bucketCaps: Record<string, number> = {
        crawl: 25,
        indexability: 25,
        onPage: 25,
        links: 15,
        enhancements: 10,
    }
    const totalPenalty = [...bucketPenalties.entries()].reduce(
        (sum, [bucket, value]) => sum + Math.min(bucketCaps[bucket] ?? 10, value),
        0,
    )
    const ruleScore = Math.max(0, Math.round(100 - totalPenalty))
    return lighthouseSeo == null
        ? ruleScore
        : Math.round(ruleScore * .85 + lighthouseSeo * .15)
}

function scoreBucket(category: string) {
    if (["ROBOTS", "SITEMAP", "REDIRECT", "CRAWL_DEPTH"].includes(category)) return "crawl"
    if (["INDEXABILITY", "CANONICAL"].includes(category)) return "indexability"
    if (["TITLE", "META_DESCRIPTION", "HEADINGS", "DUPLICATE_CONTENT"].includes(category)) return "onPage"
    if (["LINKS", "ORPHAN_PAGES"].includes(category)) return "links"
    return "enhancements"
}
