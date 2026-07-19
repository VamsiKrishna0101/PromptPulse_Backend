import prisma from "../../lib/prisma"
import { enrichSource } from "./source_enrichment_service"
import { buildChatWhere } from "../dashboard/dashboard_service"
import type { DashboardFilters } from "../dashboard/dashboard_service"

export async function getTopSources(project_id: string, filters: DashboardFilters = {}) {
    const chats = await prisma.chat.findMany({
        where: { ...buildChatWhere(project_id, filters), run: { project_id } },
        include: { sources: true }
    })

    const totalChats = chats.length
    if (totalChats === 0) return []

    const sourceMap = new Map<string, { count: number, type: string, totalCitations: number }>()

    for (const chat of chats) {
        const uniqueDomains = new Set(chat.sources.map(s => s.domain))
        
        for (const domain of uniqueDomains) {
            const sourceInfoList = chat.sources.filter(s => s.domain === domain)
            const citationsInChat = sourceInfoList.filter(s => s.is_cited).length
            const type = sourceInfoList[0]?.source_type || 'OTHER'

            const existing = sourceMap.get(domain) || { count: 0, type, totalCitations: 0 }
            
            sourceMap.set(domain, { 
                count: existing.count + 1, 
                type,
                totalCitations: existing.totalCitations + citationsInChat
            })
        }
    }

    const topSources = Array.from(sourceMap.entries()).map(([domain, data]) => ({
        domain,
        source_type: data.type,
        used_percentage: (data.count / totalChats) * 100,
        avg_citations: data.totalCitations / data.count
    })).sort((a, b) => b.used_percentage - a.used_percentage)

    return topSources
}

export async function getDomainReport(project_id: string, filters: DashboardFilters = {}) {
    const chats = await prisma.chat.findMany({
        where: { ...buildChatWhere(project_id, filters), run: { project_id } },
        include: { sources: true }
    })

    const totalChats = chats.length
    if (totalChats === 0) return []

    const domainMap = new Map<string, {
        retrievedChats: Set<string>
        citationCount: number
        sourceType: string
        urlTypes: Set<string>
        urls: Set<string>
    }>()

    for (const chat of chats) {
        for (const source of chat.sources) {
            const existing = domainMap.get(source.domain) ?? {
                retrievedChats: new Set<string>(),
                citationCount: 0,
                sourceType: source.source_type,
                urlTypes: new Set<string>(),
                urls: new Set<string>()
            }

            existing.retrievedChats.add(chat.id)
            existing.urls.add(source.url)
            existing.urlTypes.add(source.url_type)
            if (source.is_cited) existing.citationCount += 1
            domainMap.set(source.domain, existing)
        }
    }

    return Array.from(domainMap.entries()).map(([domain, data]) => {
        const retrievalCount = data.retrievedChats.size
        return {
            domain,
            source_type: data.sourceType,
            url_types: Array.from(data.urlTypes),
            unique_urls: data.urls.size,
            retrieval_count: retrievalCount,
            retrieval_rate: (retrievalCount / totalChats) * 100,
            citation_count: data.citationCount,
            citation_rate: retrievalCount > 0 ? (data.citationCount / retrievalCount) * 100 : 0
        }
    }).sort((a, b) => b.retrieval_rate - a.retrieval_rate)
}

export async function getUrlReport(project_id: string, filters: DashboardFilters = {}) {
    const sources = await prisma.source.findMany({
        where: { chat: { ...buildChatWhere(project_id, filters), run: { project_id } } },
        include: {
            source_url_content: true,
            chat: {
                include: {
                    brand_mentions: true,
                    prompt: true
                }
            }
        },
        orderBy: { created_at: "desc" }
    })

    const urlMap = new Map<string, {
        url: string
        domain: string
        title: string | null
        source_type: string
        url_type: string
        platform: string | null
        subreddit: string | null
        retrievals: number
        citations: number
        prompts: Set<string>
        mentionedBrands: Set<string>
        snippet: string | null
        content_updated_at: Date | null
        content_length: number
        fetch_status: string | null
        error_reason: string | null
    }>()

    for (const source of sources) {
        const existing = urlMap.get(source.url) ?? {
            url: source.url,
            domain: source.domain,
            title: source.title ?? source.source_url_content?.title ?? null,
            source_type: source.source_type,
            url_type: source.url_type,
            platform: source.platform,
            subreddit: source.subreddit,
            retrievals: 0,
            citations: 0,
            prompts: new Set<string>(),
            mentionedBrands: new Set<string>(),
            snippet: source.snippet ?? source.source_url_content?.snippet ?? null,
            content_updated_at: source.source_url_content?.content_updated_at ?? null,
            content_length: source.source_url_content?.content_length ?? 0,
            fetch_status: source.source_url_content?.fetch_status ?? null,
            error_reason: source.source_url_content?.error_reason ?? null
        }

        existing.retrievals += 1
        if (source.is_cited) existing.citations += 1
        existing.prompts.add(source.chat.prompt.text)
        if (!existing.snippet && source.source_url_content?.snippet) existing.snippet = source.source_url_content.snippet
        if (!existing.content_updated_at && source.source_url_content?.content_updated_at) {
            existing.content_updated_at = source.source_url_content.content_updated_at
        }
        if ((source.source_url_content?.content_length ?? 0) > existing.content_length) {
            existing.content_length = source.source_url_content?.content_length ?? 0
        }
        if (!existing.fetch_status && source.source_url_content?.fetch_status) {
            existing.fetch_status = source.source_url_content.fetch_status
        }
        if (!existing.error_reason && source.source_url_content?.error_reason) {
            existing.error_reason = source.source_url_content.error_reason
        }

        const sourceBrands = Array.isArray(source.mentioned_brands) ? source.mentioned_brands : []
        const contentBrands = Array.isArray(source.source_url_content?.mentioned_brands)
            ? source.source_url_content.mentioned_brands
            : []
        for (const brand of [...sourceBrands, ...contentBrands]) {
            if (typeof brand === "string") existing.mentionedBrands.add(brand)
        }

        urlMap.set(source.url, existing)
    }

    return Array.from(urlMap.values()).map(item => ({
        url: item.url,
        domain: item.domain,
        title: item.title,
        source_type: item.source_type,
        url_type: item.url_type,
        platform: item.platform,
        subreddit: item.subreddit,
        retrievals: item.retrievals,
        citations: item.citations,
        citation_rate: item.retrievals > 0 ? (item.citations / item.retrievals) * 100 : 0,
        prompts: Array.from(item.prompts),
        mentioned_brands: Array.from(item.mentionedBrands),
        snippet: item.snippet,
        content_updated_at: item.content_updated_at,
        content_length: item.content_length,
        fetch_status: item.fetch_status,
        error_reason: item.error_reason
    })).sort((a, b) => b.retrievals - a.retrievals)
}

export async function getUrlContent(project_id: string, url: string) {
    const source = await findProjectSourceByUrl(project_id, url)

    if (!source) return null

    if (source.source_url_content) return source.source_url_content

    const matchedContent = await findExistingContentByUrl(source.url)
    if (matchedContent) {
        await prisma.source.updateMany({
            where: { url: source.url },
            data: {
                source_url_content_id: matchedContent.id,
                title: matchedContent.title,
                snippet: matchedContent.snippet,
                source_type: matchedContent.source_type,
                url_type: matchedContent.url_type,
                platform: matchedContent.platform,
                subreddit: matchedContent.subreddit,
                mentioned_brands: matchedContent.mentioned_brands
            }
        })
        return matchedContent
    }

    // Details drawer should be useful even if the background worker has not reached this URL yet.
    return enrichSource(source.id, { ingest_sara: true })
}

async function findProjectSourceByUrl(project_id: string, url: string) {
    const exact = await prisma.source.findFirst({
        where: {
            url,
            chat: { run: { project_id } }
        },
        include: { source_url_content: true },
        orderBy: { created_at: "desc" }
    })
    if (exact) return exact

    const targetKey = canonicalUrlKey(url)
    const domain = safeDomain(url)
    const candidates = await prisma.source.findMany({
        where: {
            domain,
            chat: { run: { project_id } }
        },
        include: { source_url_content: true },
        orderBy: { created_at: "desc" },
        take: 100
    })

    return candidates.find(source => canonicalUrlKey(source.url) === targetKey) ?? null
}

async function findExistingContentByUrl(url: string) {
    const exact = await prisma.sourceUrlContent.findUnique({ where: { url } })
    if (exact) return exact

    const targetKey = canonicalUrlKey(url)
    const domain = safeDomain(url)
    const candidates = await prisma.sourceUrlContent.findMany({
        where: { domain },
        orderBy: { updated_at: "desc" },
        take: 100
    })

    return candidates.find(content => canonicalUrlKey(content.url) === targetKey) ?? null
}

function canonicalUrlKey(url: string) {
    try {
        const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
        parsed.hash = ""
        for (const key of Array.from(parsed.searchParams.keys())) {
            if (
                key.toLowerCase().startsWith("utm_") ||
                ["fbclid", "gclid", "msclkid"].includes(key.toLowerCase())
            ) {
                parsed.searchParams.delete(key)
            }
        }
        const host = parsed.hostname.replace(/^www\./, "").toLowerCase()
        const path = parsed.pathname.replace(/\/+$/, "") || "/"
        const query = parsed.searchParams.toString()
        return `${host}${path}${query ? `?${query}` : ""}`
    } catch {
        return url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "")
    }
}

function safeDomain(url: string) {
    try {
        return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase()
    } catch {
        return url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    }
}

export async function getSourceTrend(project_id: string) {
    const chats = await prisma.chat.findMany({
        where: { run: { project_id } },
        include: { sources: true },
        orderBy: { created_at: "asc" }
    })

    if (chats.length === 0) return []

    const topDomains = await getDomainReport(project_id)
    const domainSet = new Set(topDomains.slice(0, 6).map(source => source.domain))
    const dayMap = new Map<string, {
        date: string
        label: string
        total_chats: number
        domains: Map<string, { domain: string, source_type: string, chats: Set<string>, citations: number }>
    }>()

    for (const chat of chats) {
        const date = chat.created_at.toISOString().slice(0, 10)
        const existingDay = dayMap.get(date) ?? {
            date,
            label: chat.created_at.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
            total_chats: 0,
            domains: new Map<string, { domain: string, source_type: string, chats: Set<string>, citations: number }>()
        }
        existingDay.total_chats += 1

        const uniqueSourceDomains = new Set<string>()
        for (const source of chat.sources) {
            if (!domainSet.has(source.domain) || uniqueSourceDomains.has(source.domain)) continue
            uniqueSourceDomains.add(source.domain)

            const domainData = existingDay.domains.get(source.domain) ?? {
                domain: source.domain,
                source_type: source.source_type,
                chats: new Set<string>(),
                citations: 0
            }
            domainData.chats.add(chat.id)
            domainData.citations += chat.sources.filter(item => item.domain === source.domain && item.is_cited).length
            existingDay.domains.set(source.domain, domainData)
        }

        dayMap.set(date, existingDay)
    }

    return Array.from(dayMap.values()).map(day => ({
        date: day.date,
        label: day.label,
        total_chats: day.total_chats,
        domains: Array.from(day.domains.values()).map(domain => ({
            domain: domain.domain,
            source_type: domain.source_type,
            usage_percentage: day.total_chats > 0 ? (domain.chats.size / day.total_chats) * 100 : 0,
            citation_count: domain.citations
        }))
    }))
}

export async function getSourceGaps(project_id: string) {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: project_id },
        include: { competitors: true }
    })

    const sources = await prisma.source.findMany({
        where: {
            chat: {
                run: { project_id }
            }
        },
        include: {
            source_url_content: true,
            chat: {
                include: {
                    brand_mentions: true
                }
            }
        }
    })

    const brandName = project.brand_name.toLowerCase()
    const trackedCompetitors = new Set(project.competitors.map(competitor => competitor.name.toLowerCase()))
    const gapMap = new Map<string, {
        url: string
        domain: string
        title: string | null
        source_type: string
        url_type: string
        platform: string | null
        subreddit: string | null
        retrievals: number
        citations: number
        mentionedOwnBrand: boolean
        mentionedCompetitors: Set<string>
        trackedCompetitors: Set<string>
    }>()

    for (const source of sources) {
        const existing = gapMap.get(source.url) ?? {
            url: source.url,
            domain: source.domain,
            title: source.title ?? source.source_url_content?.title ?? null,
            source_type: source.source_type,
            url_type: source.url_type,
            platform: source.platform,
            subreddit: source.subreddit,
            retrievals: 0,
            citations: 0,
            mentionedOwnBrand: false,
            mentionedCompetitors: new Set<string>(),
            trackedCompetitors: new Set<string>()
        }

        existing.retrievals += 1
        if (source.is_cited) existing.citations += 1

        const sourceBrands = Array.isArray(source.mentioned_brands)
            ? source.mentioned_brands.filter((brand): brand is string => typeof brand === "string")
            : []
        const candidateBrands = [
            project.brand_name,
            ...project.competitors.map(competitor => competitor.name),
            ...source.chat.brand_mentions.map(mention => mention.brand_name)
        ]
        const inferredBrands = inferBrandsFromSourceIdentity(source.url, source.domain, source.title ?? source.source_url_content?.title ?? null, candidateBrands)
        const sourceLevelBrands = sourceBrands.length > 0 ? sourceBrands : inferredBrands
        const answerCompetitorBrands = source.chat.brand_mentions
            .map(mention => mention.brand_name)
            .filter(brand => brand.toLowerCase() !== brandName)
        const competitorBrands = sourceLevelBrands.length > 0 ? sourceLevelBrands : answerCompetitorBrands

        for (const brand of sourceLevelBrands) {
            const normalized = brand.toLowerCase()
            if (normalized === brandName) {
                existing.mentionedOwnBrand = true
            }
        }

        for (const brand of competitorBrands) {
            const normalized = brand.toLowerCase()
            if (normalized !== brandName) {
                existing.mentionedCompetitors.add(brand)
                if (trackedCompetitors.has(normalized)) {
                    existing.trackedCompetitors.add(brand)
                }
            }
        }

        gapMap.set(source.url, existing)
    }

    return Array.from(gapMap.values()).map(url => {
        const competitorHits = Array.from(url.mentionedCompetitors)
        return {
            url: url.url,
            domain: url.domain,
            title: url.title,
            source_type: url.source_type,
            url_type: url.url_type,
            platform: url.platform,
            subreddit: url.subreddit,
            retrievals: url.retrievals,
            citations: url.citations,
            mentioned_own_brand: url.mentionedOwnBrand,
            mentioned_competitors: competitorHits,
            tracked_competitors: Array.from(url.trackedCompetitors),
            gap_score: !url.mentionedOwnBrand && competitorHits.length > 0 ? url.retrievals * competitorHits.length : 0,
            suggested_action: buildSuggestedAction(url, url.mentionedOwnBrand, competitorHits)
        }
    }).filter(gap => gap.gap_score > 0).sort((a, b) => b.gap_score - a.gap_score)
}

function buildSuggestedAction(
    url: { domain: string, platform: string | null, subreddit: string | null, url_type: string },
    hasBrand: boolean,
    competitors: string[]
) {
    if (hasBrand) return "Maintain presence on this source."
    if (url.platform === "reddit") {
        return `Join or monitor ${url.subreddit ?? "this Reddit discussion"} because competitors ${competitors.join(", ")} are visible there.`
    }
    if (url.url_type === "LISTICLE" || url.url_type === "COMPARISON") {
        return `Pitch ${url.domain} or improve content so your brand appears alongside ${competitors.join(", ")}.`
    }
    return `Investigate ${url.domain}; competitors ${competitors.join(", ")} appear in a source used by AI answers.`
}

function inferBrandsFromSourceIdentity(url: string, domain: string, title: string | null, brands: string[]) {
    const haystack = `${url} ${domain} ${title ?? ""}`.toLowerCase()
    const normalizedDomain = domain.replace(/^www\./, "").split(".")[0].toLowerCase()

    return [...new Set(brands.filter(brand => {
        const normalizedBrand = brand.toLowerCase()
        const compactBrand = normalizedBrand.replace(/[^a-z0-9]/g, "")
        const compactHaystack = haystack.replace(/[^a-z0-9]/g, "")

        return haystack.includes(normalizedBrand)
            || compactHaystack.includes(compactBrand)
            || compactBrand.includes(normalizedDomain)
            || normalizedDomain.includes(compactBrand)
    }))]
}
