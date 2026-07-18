import prisma from "../../../lib/prisma"
import { formatDate, formatNumber, formatPercent, type SaraContextSection } from "./context_format"

export async function buildSaraSourceContext(project_id: string): Promise<SaraContextSection> {
    const sources = await prisma.source.findMany({
        where: { chat: { run: { project_id } } },
        include: {
            source_url_content: true,
            chat: {
                select: {
                    brand_mentioned: true,
                    prompt: { select: { text: true, topic: true } },
                },
            },
        },
        orderBy: { created_at: "desc" },
        take: 500,
    })

    const domainMap = new Map<string, {
        domain: string
        type: string
        uses: number
        citations: number
        enriched: number
        brandMentions: number
        sampleTitle: string | null
        lastUpdated: Date | null
    }>()

    for (const source of sources) {
        const current = domainMap.get(source.domain) ?? {
            domain: source.domain,
            type: source.source_type,
            uses: 0,
            citations: 0,
            enriched: 0,
            brandMentions: 0,
            sampleTitle: source.title ?? source.source_url_content?.title ?? null,
            lastUpdated: null,
        }
        current.uses += 1
        if (source.is_cited) current.citations += 1
        if (source.chat.brand_mentioned) current.brandMentions += 1
        if (source.source_url_content?.fetch_status === "SUCCESS") current.enriched += 1
        if (!current.sampleTitle && (source.title || source.source_url_content?.title)) {
            current.sampleTitle = source.title ?? source.source_url_content?.title ?? null
        }
        if (!current.lastUpdated || source.updated_at > current.lastUpdated) {
            current.lastUpdated = source.updated_at
        }
        domainMap.set(source.domain, current)
    }

    const totalChats = new Set(sources.map(source => source.chat_id)).size
    const topSources = Array.from(domainMap.values())
        .sort((a, b) => b.uses - a.uses)
        .slice(0, 8)
        .map(source => `${source.domain}: used ${formatPercent(totalChats ? (source.uses / totalChats) * 100 : 0)}, citations ${source.citations}, type ${source.type}, enriched ${source.enriched}/${source.uses}`)

    const sourceGaps = Array.from(domainMap.values())
        .filter(source => source.uses > 0 && source.brandMentions === 0)
        .sort((a, b) => b.uses - a.uses)
        .slice(0, 6)
        .map(source => `${source.domain}: AI uses it ${source.uses} time(s) but brand was not mentioned; title ${source.sampleTitle ?? "n/a"}`)

    const enrichedCount = sources.filter(source => source.source_url_content?.fetch_status === "SUCCESS").length
    const failedEnrichment = sources.filter(source => source.source_url_content?.fetch_status === "FAILED").length

    return {
        title: "Source Intelligence",
        lines: [
            `Unique source domains: ${domainMap.size}`,
            `Source URL records: ${sources.length}; enriched ${enrichedCount}; failed enrichment ${failedEnrichment}`,
            topSources.length ? `Top source domains: ${topSources.join(" | ")}` : "No source domains have been captured yet.",
            sourceGaps.length ? `Source gaps: ${sourceGaps.join(" | ")}` : "No obvious source gaps found from enriched/cited sources yet.",
            `Average URLs per domain: ${formatNumber(domainMap.size ? sources.length / domainMap.size : 0)}`,
            sources[0] ? `Latest source captured: ${formatDate(sources[0].created_at)}` : null,
        ],
    }
}
