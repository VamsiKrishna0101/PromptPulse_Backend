import { createHash } from "node:crypto"
import { JSDOM } from "jsdom"
import type { SeoV2CrawlErrorCode } from "@prisma/client"
import { normalizeAuditUrl, sameOrigin } from "./site_audit_url_policy"
import type { AuditPage } from "./site_audit_types"

const MAX_PAGE_BYTES = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const USER_AGENT = "PromptPulse-SEO-Audit/1.0"

function errorCode(status: number | null, error: unknown): SeoV2CrawlErrorCode {
    if (error) {
        const name = error && typeof error === "object" && "name" in error
            ? String(error.name)
            : ""
        return name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "DNS_FAILURE"
    }
    if (status === 403) return "HTTP_403"
    if (status === 404) return "HTTP_404"
    if (status === 500) return "HTTP_500"
    if (status != null && status >= 500) return "HTTP_5XX"
    if (status != null && status >= 400) return "HTTP_4XX"
    return "NONE"
}

function emptyPage(url: string, depth: number, status: number | null, error: unknown): AuditPage {
    return {
        url,
        statusCode: status,
        contentType: null,
        isHtml: false,
        errorCode: errorCode(status, error),
        redirectChain: [],
        crawlDepth: depth,
        inboundLinksCount: 0,
        isOrphan: false,
        indexable: status != null && status >= 200 && status < 300,
        robotsBlocked: false,
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
}

function schemaTypes(document: Document) {
    const types = new Set<string>()
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
            const parsed = JSON.parse(script.textContent ?? "")
            const values = Array.isArray(parsed) ? parsed : [parsed]
            for (const value of values) {
                const type = value && typeof value === "object" ? value["@type"] : null
                if (typeof type === "string") types.add(type)
                if (Array.isArray(type)) type.filter(item => typeof item === "string").forEach(item => types.add(item))
            }
        } catch {
            // Invalid JSON-LD is still treated as schema presence and surfaced later.
        }
    }
    return [...types]
}

export async function fetchAndAnalyzePage(input: {
    url: string
    origin: string
    depth: number
}): Promise<AuditPage> {
    const started = Date.now()
    try {
        const response = await fetch(input.url, {
            redirect: "manual",
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        const page = emptyPage(input.url, input.depth, response.status, null)
        page.responseTimeMs = Date.now() - started
        page.contentType = response.headers.get("content-type")?.toLowerCase() ?? null
        const redirect = response.headers.get("location")
        if (redirect && response.status >= 300 && response.status < 400) {
            const target = normalizeAuditUrl(redirect, input.url)
            page.redirectChain = target ? [target] : []
            return page
        }
        if (!response.ok) return page

        const contentType = page.contentType ?? ""
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
            return page
        }
        page.isHtml = true
        const body = await response.text()
        page.pageSizeBytes = Buffer.byteLength(body)
        if (page.pageSizeBytes > MAX_PAGE_BYTES) {
            page.errorCode = "PARSE_ERROR"
            return page
        }

        const dom = new JSDOM(body, { url: input.url })
        const document = dom.window.document
        const title = document.querySelector("title")?.textContent?.trim() || null
        const metaDescription = document
            .querySelector('meta[name="description"]')
            ?.getAttribute("content")
            ?.trim() || null
        const canonicalRaw = document
            .querySelector('link[rel~="canonical"]')
            ?.getAttribute("href")
        const canonicalUrl = canonicalRaw ? normalizeAuditUrl(canonicalRaw, input.url) : null
        const robots = [
            document.querySelector('meta[name="robots"]')?.getAttribute("content"),
            response.headers.get("x-robots-tag"),
        ].filter(Boolean).join(",").toLowerCase()
        const noindex = robots.includes("noindex")
        const bodyClone = document.body?.cloneNode(true) as HTMLElement | undefined
        bodyClone?.querySelectorAll("script,style,noscript,svg").forEach(node => node.remove())
        const bodyText = bodyClone?.textContent?.replace(/\s+/g, " ").trim() ?? ""
        const links = new Set<string>()
        let externalLinks = 0
        for (const anchor of document.querySelectorAll("a[href]")) {
            const href = anchor.getAttribute("href")
            if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue
            const resolved = normalizeAuditUrl(href, input.url)
            if (!resolved) continue
            if (sameOrigin(resolved, input.origin)) links.add(resolved)
            else externalLinks += 1
        }
        const images = [...document.querySelectorAll("img")]
        const schemas = schemaTypes(document)
        const h1s = [...document.querySelectorAll("h1")]
        page.title = title
        page.metaDescription = metaDescription
        page.canonicalUrl = canonicalUrl
        page.canonicalIsSelf = !canonicalUrl || canonicalUrl === input.url
        page.noindex = noindex
        page.indexable = !noindex
        page.h1 = h1s[0]?.textContent?.trim() || null
        page.h1Count = h1s.length
        page.h2Count = document.querySelectorAll("h2").length
        page.wordCount = bodyText ? bodyText.split(/\s+/).length : 0
        page.contentHash = bodyText
            ? createHash("sha256").update(bodyText).digest("hex")
            : null
        page.hasViewport = Boolean(document.querySelector('meta[name="viewport"]'))
        page.hasSchema = document.querySelectorAll('script[type="application/ld+json"]').length > 0
        page.schemaTypes = schemas
        page.imagesTotal = images.length
        page.imagesMissingAlt = images.filter(image => !image.hasAttribute("alt")).length
        page.internalLinks = [...links]
        page.externalLinks = externalLinks
        return page
    } catch (error) {
        const page = emptyPage(input.url, input.depth, null, error)
        page.responseTimeMs = Date.now() - started
        return page
    }
}
