import axios from "axios"
import { JSDOM } from "jsdom"
import type { CrawledSeoPage } from "./seo_types"

const MAX_PAGES = 25
const REQUEST_TIMEOUT_MS = 12_000
const NON_HTML_ASSET_PATTERN = /\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|docx?|xlsx?|csv|json|xml|md|txt)($|\?)/i

function normalizeUrl(input: string) {
    const raw = input.trim()
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    const parsed = new URL(withProtocol)
    parsed.hash = ""
    return parsed.toString().replace(/\/$/, "")
}

function sameHost(url: string, root: URL) {
    try {
        const parsed = new URL(url)
        return parsed.hostname.replace(/^www\./, "") === root.hostname.replace(/^www\./, "")
    } catch {
        return false
    }
}

function textOf(document: Document, selector: string) {
    return document.querySelector(selector)?.textContent?.trim().replace(/\s+/g, " ") || null
}

function attrOf(document: Document, selector: string, attr: string) {
    return document.querySelector(selector)?.getAttribute(attr)?.trim() || null
}

function absoluteUrl(url: string, base: string) {
    try {
        return new URL(url, base).toString().replace(/\/$/, "")
    } catch {
        return null
    }
}

async function fetchText(url: string) {
    const response = await axios.get<string>(url, {
        timeout: REQUEST_TIMEOUT_MS,
        responseType: "text",
        validateStatus: status => status >= 200 && status < 500,
        headers: {
            "User-Agent": "PromptPulse SEO Auditor/1.0",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    })
    return { status: response.status, body: String(response.data ?? "") }
}

async function discoverSitemapUrls(rootUrl: string) {
    const root = new URL(rootUrl)
    const urls = new Set<string>()
    for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
        try {
            const sitemapUrl = `${root.origin}${path}`
            const { body } = await fetchText(sitemapUrl)
            const matches = body.match(/<loc>\s*([^<]+)\s*<\/loc>/gi) ?? []
            for (const match of matches) {
                const loc = match.replace(/<\/?loc>/gi, "").trim()
                const absolute = absoluteUrl(loc, rootUrl)
                if (absolute && sameHost(absolute, root) && !NON_HTML_ASSET_PATTERN.test(absolute)) urls.add(absolute)
                if (urls.size >= MAX_PAGES) break
            }
        } catch {
            // Sitemap is optional.
        }
        if (urls.size >= MAX_PAGES) break
    }
    return [...urls]
}

function discoverInternalLinks(html: string, pageUrl: string, root: URL) {
    const dom = new JSDOM(html)
    const links = [...dom.window.document.querySelectorAll("a[href]")]
        .map(link => absoluteUrl(link.getAttribute("href") ?? "", pageUrl))
        .filter((url): url is string => Boolean(url))
        .filter(url => sameHost(url, root))
        .filter(url => !NON_HTML_ASSET_PATTERN.test(url))
    return [...new Set(links)]
}

function inferPageType(url: string, title: string | null, h1: string | null) {
    const text = `${url} ${title ?? ""} ${h1 ?? ""}`.toLowerCase()
    if (/\b(contact|location|directions)\b/.test(text)) return "LOCATION"
    if (/\b(blog|article|guide|resources)\b/.test(text)) return "ARTICLE"
    if (/\b(service|treatment|department|speciality|specialty)\b/.test(text)) return "SERVICE"
    if (/\b(doctor|physician|consultant|team)\b/.test(text)) return "EXPERT"
    if (/\b(pricing|cost|insurance|cashless)\b/.test(text)) return "PAYMENT"
    return "OTHER"
}

function detectServices(text: string) {
    const services = [
        "cardiology", "orthopedics", "maternity", "gynecology", "pediatrics", "neurology",
        "gastroenterology", "urology", "oncology", "general surgery", "emergency", "ICU",
        "diagnostics", "insurance", "cashless", "dental", "dermatology", "ENT"
    ]
    const lower = text.toLowerCase()
    return services.filter(service => lower.includes(service.toLowerCase()))
}

function detectLocations(text: string, projectLocation: string) {
    const candidates = projectLocation.split(",").map(item => item.trim()).filter(Boolean)
    const lower = text.toLowerCase()
    return candidates.filter(item => lower.includes(item.toLowerCase()))
}

function parsePage(url: string, status: number | null, html: string, projectLocation: string): CrawledSeoPage {
    const dom = new JSDOM(html)
    const document = dom.window.document
    const text = document.body?.textContent?.replace(/\s+/g, " ").trim() ?? ""
    const title = textOf(document, "title")
    const meta_description = attrOf(document, 'meta[name="description"]', "content")
    const h1 = textOf(document, "h1")
    const canonical = attrOf(document, 'link[rel="canonical"]', "href")
    const robots = attrOf(document, 'meta[name="robots"]', "content")?.toLowerCase() ?? ""
    const has_schema = document.querySelectorAll('script[type="application/ld+json"]').length > 0
    const has_faq = /faq|frequently asked questions/i.test(text) || html.includes("FAQPage")

    return {
        url,
        status_code: status,
        html,
        title,
        meta_description,
        h1,
        canonical,
        word_count: text.split(/\s+/).filter(Boolean).length,
        indexable: !/(noindex|none)/.test(robots),
        has_viewport: Boolean(attrOf(document, 'meta[name="viewport"]', "content")),
        has_schema,
        has_faq,
        detected_services: detectServices(text),
        detected_locations: detectLocations(text, projectLocation),
        page_type: inferPageType(url, title, h1),
        text,
    }
}

export async function crawlSeoSite(input: { rootUrl: string; projectLocation: string; maxPages?: number }) {
    const startUrl = normalizeUrl(input.rootUrl)
    const root = new URL(startUrl)
    const maxPages = Math.min(Math.max(input.maxPages ?? MAX_PAGES, 1), MAX_PAGES)
    const queue = [startUrl, ...(await discoverSitemapUrls(startUrl))]
    const seen = new Set<string>()
    const pages: CrawledSeoPage[] = []

    while (queue.length && pages.length < maxPages) {
        const url = queue.shift()
        if (!url || seen.has(url) || !sameHost(url, root)) continue
        seen.add(url)

        try {
            const { status, body } = await fetchText(url)
            const page = parsePage(url, status, body, input.projectLocation)
            pages.push(page)

            if (pages.length < maxPages) {
                for (const link of discoverInternalLinks(body, url, root).slice(0, 20)) {
                    if (!seen.has(link) && queue.length < maxPages * 3) queue.push(link)
                }
            }
        } catch {
            pages.push(parsePage(url, null, "", input.projectLocation))
        }
    }

    return pages
}
