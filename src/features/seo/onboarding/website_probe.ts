import type { WebsitePageProbe, WebsiteProbeResult } from "./onboarding_types"

const FETCH_TIMEOUT_MS = 12_000
const MAX_HTML_BYTES = 2_000_000

function safeUrl(input: string): URL {
    const url = new URL(input)
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only HTTP and HTTPS website URLs are supported")
    const hostname = url.hostname.toLowerCase()
    const privateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(hostname)
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1" || hostname.startsWith("127.") || hostname.startsWith("0.") || privateIpv4) {
        throw new Error("Local website URLs are not supported")
    }
    url.hash = ""
    return url
}

function text(value: string) {
    return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim()
}

function firstMatch(html: string, pattern: RegExp): string | null {
    const match = html.match(pattern)
    return match?.[1] ? text(match[1]).slice(0, 500) || null : null
}

function linksFrom(html: string, base: URL, host: string) {
    const links = new Set<string>()
    for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
        try {
            const link = new URL(match[1], base)
            link.hash = ""
            if ((link.protocol === "http:" || link.protocol === "https:") && link.hostname === host) links.add(link.toString())
        } catch { /* Ignore malformed links. */ }
    }
    return [...links]
}

async function fetchHtml(url: URL) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
        const response = await fetch(url, {
            redirect: "follow",
            signal: controller.signal,
            headers: { "user-agent": "PromptPulse-Onboarding/1.0 (+https://promptpulse.app)" },
        })
        const contentType = response.headers.get("content-type") ?? ""
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) return { response, html: "" }
        const reader = response.body?.getReader()
        if (!reader) return { response, html: await response.text() }
        const chunks: Uint8Array[] = []
        let size = 0
        while (size < MAX_HTML_BYTES) {
            const chunk = await reader.read()
            if (chunk.done) break
            chunks.push(chunk.value)
            size += chunk.value.byteLength
        }
        await reader.cancel().catch(() => undefined)
        return { response, html: Buffer.concat(chunks).toString("utf8") }
    } finally {
        clearTimeout(timer)
    }
}

function probe(url: URL, status: number | null, html: string): WebsitePageProbe {
    const body = firstMatch(html, /<body\b[^>]*>([\s\S]*?)<\/body>/i) ?? html
    return {
        url: url.toString(),
        status,
        title: firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i),
        meta_description: firstMatch(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ?? firstMatch(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i),
        h1: firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i),
        internal_links: linksFrom(html, url, url.hostname).length,
        word_count: text(body).split(/\s+/).filter(Boolean).length,
    }
}

export async function probeWebsite(startUrl: string, maxPages: number): Promise<WebsiteProbeResult> {
    const root = safeUrl(startUrl)
    const queue = [root]
    const seen = new Set<string>()
    const pages: WebsitePageProbe[] = []
    const failed_urls: string[] = []
    let sitemap_url: string | null = null

    while (queue.length && pages.length < maxPages) {
        const url = queue.shift()!
        const key = url.toString()
        if (seen.has(key)) continue
        seen.add(key)
        try {
            const { response, html } = await fetchHtml(url)
            pages.push(probe(url, response.status, html))
            if (url.pathname === "/" && response.ok) {
                const sitemap = html.match(/<link\b[^>]*rel=["']sitemap["'][^>]*href=["']([^"']+)["']/i)?.[1]
                sitemap_url = sitemap ? new URL(sitemap, url).toString() : `${url.origin}/sitemap.xml`
            }
            for (const link of linksFrom(html, url, root.hostname).slice(0, maxPages * 2)) {
                if (!seen.has(link) && queue.length < maxPages * 3) queue.push(new URL(link))
            }
        } catch {
            failed_urls.push(key)
        }
    }

    if (!pages.length) throw new Error("The website could not be reached")
    return { homepage: pages[0], pages, sitemap_url, failed_urls }
}
