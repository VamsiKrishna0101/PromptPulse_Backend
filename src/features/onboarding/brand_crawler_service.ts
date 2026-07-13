import axios from 'axios'
import https from 'https'
import { hasFirecrawlKey, scrapeWithFirecrawl, type FirecrawlPage } from './crawlers/firecrawl_client'

type CrawledPage = {
    url: string
    title: string | null
    description: string | null
    headings: string[]
    body_text: string
}

export type BrandCrawlResult = {
    brand_name: string
    brand_url: string
    source: 'website_crawler' | 'firecrawl_fallback'
    pages_crawled: number
    pages: CrawledPage[]
    social_links: string[]
    important_links: string[]
    crawler_notes?: string[]
}

const MAX_PAGES = 8
const MAX_FIRECRAWL_PAGES = 4
const MAX_TEXT_PER_PAGE = 4500
const MIN_USEFUL_TEXT_LENGTH = 120

export async function crawlBrandWebsite(brand_name: string, brand_url: string): Promise<BrandCrawlResult> {
    const rootUrl = normalizeUrl(brand_url)
    const notes: string[] = []
    let homepage: { url: string; html: string } | null = null
    let importantLinks: string[] = []

    try {
        homepage = await fetchPage(rootUrl)
        const links = extractLinks(homepage.html, rootUrl)
        importantLinks = pickImportantLinks(links, rootUrl)
    } catch (error) {
        notes.push(`Static homepage crawl failed: ${getErrorMessage(error)}`)
    }

    if (!homepage) {
        return crawlWithFirecrawlFallback(brand_name, rootUrl, importantLinks, notes)
    }

    const urlsToCrawl = [rootUrl, ...importantLinks].slice(0, MAX_PAGES)

    const pages: CrawledPage[] = []
    const socialLinks = new Set<string>()

    for (const url of urlsToCrawl) {
        try {
            const page = url === rootUrl ? homepage : await fetchPage(url)
            const extracted = extractPage(page.url, page.html)
            pages.push(extracted)
            extractSocialLinks(page.html).forEach(link => socialLinks.add(link))
        } catch (error) {
            notes.push(`Static page crawl failed for ${url}: ${getErrorMessage(error)}`)
            // Public sites often block one route; keep the useful pages we already have.
        }
    }

    if (isThinCrawl(pages) && hasFirecrawlKey()) {
        notes.push('Static crawl returned thin content, switching to Firecrawl fallback.')
        return crawlWithFirecrawlFallback(brand_name, rootUrl, importantLinks, notes)
    }

    if (isThinCrawl(pages)) {
        throw new Error('Website crawl did not return enough useful brand content.')
    }

    return {
        brand_name,
        brand_url: rootUrl,
        source: 'website_crawler',
        pages_crawled: pages.length,
        pages,
        social_links: Array.from(socialLinks),
        important_links: importantLinks.slice(0, MAX_PAGES - 1),
        crawler_notes: notes,
    }
}

async function crawlWithFirecrawlFallback(
    brand_name: string,
    rootUrl: string,
    importantLinks: string[],
    notes: string[]
): Promise<BrandCrawlResult> {
    const urlsToCrawl = unique([rootUrl, ...importantLinks]).slice(0, MAX_FIRECRAWL_PAGES)
    const pages: CrawledPage[] = []
    const socialLinks = new Set<string>()

    if (!hasFirecrawlKey()) {
        throw new Error(`${notes.join(' ')} Firecrawl fallback is not configured.`.trim())
    }

    for (const url of urlsToCrawl) {
        try {
            const page = await scrapeWithFirecrawl(url)
            pages.push(extractFirecrawlPage(page))

            if (page.html) {
                extractSocialLinks(page.html).forEach(link => socialLinks.add(link))
            }
        } catch (error) {
            notes.push(`Firecrawl failed for ${url}: ${getErrorMessage(error)}`)
        }
    }

    if (isThinCrawl(pages)) {
        throw new Error(notes.join(' ') || 'Firecrawl fallback did not return enough useful brand content.')
    }

    return {
        brand_name,
        brand_url: rootUrl,
        source: 'firecrawl_fallback',
        pages_crawled: pages.length,
        pages,
        social_links: Array.from(socialLinks),
        important_links: importantLinks.slice(0, MAX_FIRECRAWL_PAGES - 1),
        crawler_notes: notes,
    }
}

function normalizeUrl(value: string): string {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
    const url = new URL(withProtocol)
    url.hash = ''
    return url.toString().replace(/\/$/, '')
}

async function fetchPage(url: string): Promise<{ url: string; html: string }> {
    const requestConfig = {
        timeout: 15000,
        maxRedirects: 5,
        responseType: 'text',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        validateStatus: (status: number) => status >= 200 && status < 400,
    } as const

    let response
    try {
        response = await axios.get<string>(url, requestConfig)
    } catch (error) {
        if (!isLocalCertificateError(error)) throw error
        response = await axios.get<string>(url, {
            ...requestConfig,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        })
    }

    return {
        url: response.request?.res?.responseUrl || url,
        html: response.data,
    }
}

function isLocalCertificateError(error: unknown): boolean {
    return process.env.NODE_ENV !== 'production'
        && typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: string }).code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
}

function extractPage(url: string, html: string): CrawledPage {
    const cleanedHtml = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')

    return {
        url,
        title: firstMatch(cleanedHtml, /<title[^>]*>([\s\S]*?)<\/title>/i),
        description: extractMeta(cleanedHtml, 'description') || extractMeta(cleanedHtml, 'og:description'),
        headings: extractHeadings(cleanedHtml),
        body_text: normalizeText(stripTags(cleanedHtml)).slice(0, MAX_TEXT_PER_PAGE),
    }
}

function extractFirecrawlPage(page: FirecrawlPage): CrawledPage {
    const bodyText = normalizeText(page.markdown).slice(0, MAX_TEXT_PER_PAGE)

    return {
        url: page.url,
        title: page.title,
        description: page.description,
        headings: extractMarkdownHeadings(page.markdown),
        body_text: bodyText,
    }
}

function extractMarkdownHeadings(markdown: string): string[] {
    const headings = markdown
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^#{1,3}\s+/.test(line))
        .map(line => normalizeText(line.replace(/^#{1,3}\s+/, '')))

    return unique(headings).slice(0, 30)
}

function extractMeta(html: string, name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
        new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i'),
    ]
    for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match?.[1]) return decodeHtml(match[1])
    }
    return null
}

function extractHeadings(html: string): string[] {
    const matches = Array.from(html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    return unique(matches.map(match => normalizeText(stripTags(match[1]))).filter(Boolean)).slice(0, 30)
}

function extractLinks(html: string, baseUrl: string): string[] {
    const base = new URL(baseUrl)
    const links = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi))
        .map(match => toAbsoluteUrl(match[1], base))
        .filter((url): url is string => Boolean(url))
        .filter(url => {
            const parsed = new URL(url)
            return parsed.hostname === base.hostname && !/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip)$/i.test(parsed.pathname)
        })

    return unique(links)
}

function pickImportantLinks(links: string[], rootUrl: string): string[] {
    const wanted = [
        'about',
        'product',
        'products',
        'solution',
        'solutions',
        'platform',
        'pricing',
        'customers',
        'case-studies',
        'features',
        'services',
        'company',
    ]

    return links
        .filter(link => link !== rootUrl)
        .map(link => ({ link, score: wanted.reduce((score, word) => score + (link.toLowerCase().includes(word) ? 1 : 0), 0) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.link.length - b.link.length)
        .map(item => item.link)
        .slice(0, MAX_PAGES - 1)
}

function extractSocialLinks(html: string): string[] {
    const socialDomains = ['linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'instagram.com', 'facebook.com']
    const links = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi))
        .map(match => match[1])
        .filter(href => /^https?:\/\//i.test(href))
        .filter(href => socialDomains.some(domain => href.toLowerCase().includes(domain)))

    return unique(links).slice(0, 20)
}

function toAbsoluteUrl(href: string, base: URL): string | null {
    if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) return null
    try {
        const url = new URL(href, base)
        url.hash = ''
        return url.toString().replace(/\/$/, '')
    } catch {
        return null
    }
}

function stripTags(value: string): string {
    return decodeHtml(value.replace(/<[^>]+>/g, ' '))
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

function firstMatch(value: string, pattern: RegExp): string | null {
    const match = value.match(pattern)
    return match?.[1] ? decodeHtml(normalizeText(stripTags(match[1]))) : null
}

function decodeHtml(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values))
}

function isThinCrawl(pages: CrawledPage[]): boolean {
    return pages.length === 0 || pages.every(page => page.body_text.length < MIN_USEFUL_TEXT_LENGTH)
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return 'Unknown error'
}
