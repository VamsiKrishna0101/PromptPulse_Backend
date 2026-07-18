import axios from "axios"
import https from "https"
import { SourceType } from "@prisma/client"
import prisma from "../../lib/prisma"
import { ingestSourceContentById } from "../rag/ingestion_service"

type SourceUrlTypeValue =
    | "LISTICLE"
    | "COMPARISON"
    | "DISCUSSION"
    | "ARTICLE"
    | "DOCUMENTATION"
    | "REVIEW"
    | "SOCIAL_POST"
    | "HOMEPAGE"
    | "OTHER"

type EnrichedSource = {
    url: string
    domain: string
    title: string | null
    content: string | null
    snippet: string | null
    content_length: number
    source_type: SourceType
    url_type: SourceUrlTypeValue
    platform: string | null
    subreddit: string | null
    mentioned_brands: string[]
    fetch_status: string
    error_reason: string | null
    content_updated_at: Date
}

export async function enrichSource(source_id: string, options: {
    ingest_sara?: boolean
} = {}) {
    const source = await prisma.source.findUniqueOrThrow({
        where: { id: source_id },
        include: {
            chat: {
                include: {
                    brand_mentions: true,
                    run: {
                        include: {
                            project: {
                                include: {
                                    competitors: true
                                }
                            }
                        }
                    }
                }
            }
        }
    })

    const project = source.chat.run.project
    const brands = [
        project.brand_name,
        ...project.competitors.map(competitor => competitor.name),
        ...source.chat.brand_mentions.map(mention => mention.brand_name)
    ]

    const enriched = await fetchAndExtractSource(source.url, brands)
    const content = await prisma.sourceUrlContent.upsert({
        where: { url: source.url },
        create: enriched,
        update: enriched
    })

    await prisma.source.updateMany({
        where: { url: source.url },
        data: {
            source_url_content_id: content.id,
            title: enriched.title,
            snippet: enriched.snippet,
            source_type: enriched.source_type,
            url_type: enriched.url_type,
            platform: enriched.platform,
            subreddit: enriched.subreddit,
            mentioned_brands: enriched.mentioned_brands
        }
    })

    if (options.ingest_sara !== false) {
        await ingestSourceContentById(content.id, project.id).catch(error => {
            console.warn("Sara source ingestion failed", {
                source_url_content_id: content.id,
                project_id: project.id,
                error
            })
        })
    }

    return content
}

export async function fetchAndExtractSource(url: string, brands: string[]): Promise<EnrichedSource> {
    const normalizedUrl = ensureHttpUrl(url)
    const domain = safeDomain(normalizedUrl)
    const base = classifyUrl(normalizedUrl, domain)

    try {
        const response = await axios.get<string>(normalizedUrl, {
            timeout: Number(process.env.SOURCE_FETCH_TIMEOUT_MS ?? 20000),
            responseType: "text",
            maxRedirects: 5,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-IN,en;q=0.9"
            },
            httpsAgent: process.env.NODE_ENV !== "production"
                ? new https.Agent({ rejectUnauthorized: false })
                : undefined
        })

        const html = typeof response.data === "string" ? response.data : String(response.data)
        const title = extractTitle(html)
        const text = normalizeText(stripHtml(html)).slice(0, Number(process.env.SOURCE_CONTENT_MAX_CHARS ?? 25000))
        const snippet = buildSnippet(text, brands)
        const mentioned_brands = findMentionedBrands(text, brands)

        return {
            url: normalizedUrl,
            domain,
            title,
            content: text,
            snippet,
            content_length: text.length,
            source_type: base.source_type,
            url_type: base.url_type,
            platform: base.platform,
            subreddit: base.subreddit,
            mentioned_brands,
            fetch_status: "SUCCESS",
            error_reason: null,
            content_updated_at: new Date()
        }
    } catch (error) {
        return {
            url: normalizedUrl,
            domain,
            title: null,
            content: null,
            snippet: null,
            content_length: 0,
            source_type: base.source_type,
            url_type: base.url_type,
            platform: base.platform,
            subreddit: base.subreddit,
            mentioned_brands: [],
            fetch_status: "FAILED",
            error_reason: error instanceof Error ? error.message : "Source fetch failed",
            content_updated_at: new Date()
        }
    }
}

function classifyUrl(url: string, domain: string) {
    const lower = url.toLowerCase()
    const platform = platformFromDomain(domain)
    const subreddit = extractSubreddit(url)
    let source_type: SourceType = SourceType.OTHER
    let url_type: SourceUrlTypeValue = "OTHER"

    if (domain.includes("reddit.com") || domain.includes("quora.com")) {
        source_type = SourceType.UGC
        url_type = "DISCUSSION"
    } else if (domain.includes("linkedin.com") || domain.includes("x.com") || domain.includes("twitter.com") || domain.includes("youtube.com")) {
        source_type = SourceType.SOCIAL
        url_type = "SOCIAL_POST"
    } else if (lower.includes("review") || domain.includes("g2.com") || domain.includes("capterra.com")) {
        source_type = SourceType.REFERENCE
        url_type = "REVIEW"
    } else if (lower.includes("compare") || lower.includes("alternative") || lower.includes("vs-") || lower.includes("-vs-")) {
        source_type = SourceType.EDITORIAL
        url_type = "COMPARISON"
    } else if (lower.includes("best") || lower.includes("top-") || lower.includes("tools") || lower.includes("software")) {
        source_type = SourceType.EDITORIAL
        url_type = "LISTICLE"
    } else if (lower.includes("docs") || lower.includes("documentation")) {
        source_type = SourceType.REFERENCE
        url_type = "DOCUMENTATION"
    } else if (isHomepage(url)) {
        source_type = SourceType.CORPORATE
        url_type = "HOMEPAGE"
    } else {
        url_type = "ARTICLE"
    }

    return { source_type, url_type, platform, subreddit }
}

function safeDomain(url: string) {
    try {
        return new URL(url).hostname.replace(/^www\./, "")
    } catch {
        return url
    }
}

function ensureHttpUrl(url: string) {
    if (/^https?:\/\//i.test(url)) return url
    return `https://${url}`
}

function platformFromDomain(domain: string) {
    if (domain.includes("reddit.com")) return "reddit"
    if (domain.includes("linkedin.com")) return "linkedin"
    if (domain.includes("youtube.com")) return "youtube"
    if (domain.includes("x.com") || domain.includes("twitter.com")) return "x"
    if (domain.includes("quora.com")) return "quora"
    return null
}

function extractSubreddit(url: string) {
    const match = url.match(/reddit\.com\/r\/([^/?#]+)/i)
    return match ? `r/${decodeURIComponent(match[1])}` : null
}

function isHomepage(url: string) {
    try {
        const parsed = new URL(url)
        return parsed.pathname === "/" || parsed.pathname === ""
    } catch {
        return false
    }
}

function extractTitle(html: string) {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    if (og?.[1]) return decodeHtml(og[1]).trim()
    const title = html.match(/<title[^>]*>(.*?)<\/title>/is)
    return title?.[1] ? decodeHtml(stripHtml(title[1])).trim() : null
}

function stripHtml(html: string) {
    return html
        // Drop scripts, styles, noscripts entirely
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
        // Block-level elements → paragraph break
        .replace(/<\/?(?:p|div|section|article|main|header|footer|aside|nav|h[1-6]|ul|ol|blockquote|pre|table|thead|tbody|tr|figure|figcaption)[^>]*>/gi, "\n\n")
        // Inline line-breaks
        .replace(/<br\s*\/?>/gi, "\n")
        // List items → bullet
        .replace(/<li[^>]*>/gi, "\n• ")
        // Strip all remaining tags
        .replace(/<[^>]+>/g, "")
}

function normalizeText(text: string) {
    return decodeHtml(text)
        // Normalise spaces within each line (but keep newlines)
        .split("\n")
        .map(line => line.replace(/[ \t]+/g, " ").trim())
        .join("\n")
        // Collapse 3+ consecutive blank lines down to 2
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

function decodeHtml(value: string) {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
}

function findMentionedBrands(text: string, brands: string[]) {
    const lower = text.toLowerCase()
    return [...new Set(brands.filter(brand => lower.includes(brand.toLowerCase())))]
}

function buildSnippet(text: string, brands: string[]) {
    if (!text) return null
    const lower = text.toLowerCase()
    const brand = brands.find(item => lower.includes(item.toLowerCase()))

    if (!brand) return text.slice(0, 500)

    const index = lower.indexOf(brand.toLowerCase())
    const start = Math.max(0, index - 220)
    const end = Math.min(text.length, index + brand.length + 280)
    return text.slice(start, end).trim()
}
