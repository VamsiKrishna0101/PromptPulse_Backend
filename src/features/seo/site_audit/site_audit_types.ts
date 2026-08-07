import type {
    SeoV2CrawlErrorCode,
    SeoV2IssueCategory,
    SeoV2IssueSeverity,
} from "@prisma/client"

export type AuditPage = {
    url: string
    statusCode: number | null
    contentType: string | null
    isHtml: boolean
    errorCode: SeoV2CrawlErrorCode
    redirectChain: string[]
    crawlDepth: number
    inboundLinksCount: number
    isOrphan: boolean
    indexable: boolean
    robotsBlocked: boolean
    noindex: boolean
    canonicalIsSelf: boolean
    canonicalUrl: string | null
    title: string | null
    metaDescription: string | null
    h1: string | null
    h1Count: number
    h2Count: number
    wordCount: number
    contentHash: string | null
    hasViewport: boolean
    hasSchema: boolean
    schemaTypes: string[]
    imagesTotal: number
    imagesMissingAlt: number
    internalLinks: string[]
    externalLinks: number
    pageSizeBytes: number | null
    responseTimeMs: number | null
}

export type AuditIssue = {
    pageUrl: string | null
    category: SeoV2IssueCategory
    severity: SeoV2IssueSeverity
    title: string
    description: string
    evidence: string
    whyItMatters: string
    recommendedFix: string
    affectedPagesCount?: number
    exampleUrls?: string[]
    priorityScore: number
}

export type CrawlResult = {
    pages: AuditPage[]
    issues: AuditIssue[]
    robotsTxtUrl: string
    robotsTxtRaw: string | null
    sitemapUrlsFound: number
    queuedUrls: number
    partialReason: string | null
}
