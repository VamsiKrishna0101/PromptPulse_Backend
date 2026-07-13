import prisma from "../../lib/prisma"
import { buildChatWhere, type DashboardFilters } from "../dashboard/dashboard_service"
import { generateText } from "../llm/gemini_service"
import { getOpportunities } from "../opportunities/opportunity_service"
import { buildGeoArticleSystemPrompt, buildGeoArticleUserPrompt } from "./geo_article_prompt"
import type { GeoArticleBrief, GeoArticleCompetitorEvidence, GeoArticleEvidenceSource, GeoArticleResponse } from "./geoarticle_types"

type GeoArticleInput = {
    project_id: string
    days?: number
    topic?: string
    prompt_id?: string
    model?: string
    generate?: boolean
    geo_country?: string
    /** 0-based index into the sorted opportunity list. Default 0 = highest impact. */
    offset?: number
}

type ArticleChat = Awaited<ReturnType<typeof loadArticleChats>>[number]

function round(value: number) {
    return Number(value.toFixed(1))
}

function avg(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function cleanText(value: string, max = 240) {
    return value.replace(/\s+/g, " ").trim().slice(0, max)
}

function slugify(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 90)
}

function inferIntent(promptText: string) {
    const text = promptText.toLowerCase()
    if (text.includes("alternative") || text.includes("instead of") || text.includes("switch from")) return "Alternatives evaluation"
    if (text.includes("compare") || text.includes(" vs ") || text.includes("versus") || text.includes("difference between")) return "Comparison research"
    if (text.includes("best") || text.includes("top") || text.includes("leading") || text.includes("recommended")) return "Best tools shortlist"
    if (text.includes("pricing") || text.includes("cost") || text.includes("price") || text.includes("worth it")) return "Pricing and value research"
    if (text.includes("how to") || text.includes("how can i") || text.includes("how do") || text.includes("step")) return "Educational how-to guide"
    if (text.includes("what is") || text.includes("what are") || text.includes("explain") || text.includes("definition")) return "Educational explanation"
    if (text.includes("why") || text.includes("should i") || text.includes("worth")) return "Decision support"
    if (text.includes("review") || text.includes("opinion") || text.includes("feedback")) return "Review and validation"
    if (text.includes("integrate") || text.includes("api") || text.includes("connect")) return "Integration research"
    if (text.includes("enterprise") || text.includes("team") || text.includes("company") || text.includes("organization")) return "Enterprise evaluation"
    if (text.includes("free") || text.includes("trial") || text.includes("demo")) return "Trial and adoption research"
    return "Category research"
}

function fallbackTitle(promptText: string, brandName: string) {
    const cleaned = cleanText(promptText, 90).replace(/[?.!]+$/, "")
    const lower = cleaned.toLowerCase()
    if (lower.includes(brandName.toLowerCase())) return cleaned
    return `${cleaned}: where ${brandName} fits`
}

function buildOutline(brief: Pick<GeoArticleBrief, "target_prompt" | "brand" | "competitors" | "sources_to_reference">) {
    const competitorNames = brief.competitors.slice(0, 3).map(competitor => competitor.name)
    const sourceDomains = brief.sources_to_reference.slice(0, 3).map(source => source.domain)

    return [
        `What is the direct answer to "${brief.target_prompt.text}"?`,
        `When should buyers choose ${brief.brand.name}?`,
        competitorNames.length
            ? `How does ${brief.brand.name} compare with ${competitorNames.join(", ")}?`
            : `What alternatives should buyers consider?`,
        sourceDomains.length
            ? `Which sources and proof points should support this answer?`
            : `What proof points should this page include?`,
        `What should buyers do next?`
    ]
}

function buildFaqs(promptText: string, brandName: string, competitors: GeoArticleCompetitorEvidence[], intent: string) {
    const competitor = competitors[0]?.name
    const topCompetitor = competitors[0]?.name ?? "other tools"
    const cleaned = promptText.replace(/[?.!]+$/, "")

    const faqs = [
        `What is the best solution for ${cleaned}?`,
        competitor
            ? `How does ${brandName} compare with ${topCompetitor} for this use case?`
            : `Who is ${brandName} built for?`,
        `Why do AI assistants like ChatGPT and Perplexity recommend certain brands over others?`,
        `What content or sources help a brand appear in AI-generated answers?`,
    ]

    if (intent.includes("Enterprise") || intent.includes("Comparison")) {
        faqs.push(`What questions should enterprise buyers ask before choosing a solution for ${cleaned}?`)
    }
    if (intent.includes("Pricing")) {
        faqs.push(`Is ${brandName} worth the cost compared with ${topCompetitor}?`)
    }
    if (intent.includes("Alternatives")) {
        faqs.push(`When is ${brandName} a better choice than ${topCompetitor}?`)
    }

    return faqs.slice(0, 6)
}

async function loadArticleChats(project_id: string, filters: DashboardFilters) {
    return prisma.chat.findMany({
        where: buildChatWhere(project_id, filters),
        include: {
            prompt: {
                select: {
                    id: true,
                    text: true,
                    topic: true,
                    type: true,
                }
            },
            brand_mentions: {
                select: {
                    brand_name: true,
                    position: true,
                    sentiment_score: true,
                }
            },
            sources: {
                select: {
                    domain: true,
                    title: true,
                    url: true,
                    source_type: true,
                    is_cited: true,
                }
            }
        },
        orderBy: { created_at: "desc" },
        take: 80
    })
}

function sourceEvidence(chats: ArticleChat[]): GeoArticleEvidenceSource[] {
    const map = new Map<string, GeoArticleEvidenceSource>()

    for (const chat of chats) {
        const seen = new Set<string>()
        for (const source of chat.sources) {
            if (!source.domain || seen.has(source.domain)) continue
            seen.add(source.domain)

            const existing = map.get(source.domain)
            map.set(source.domain, {
                domain: source.domain,
                title: existing?.title ?? source.title ?? null,
                url: existing?.url ?? source.url ?? null,
                source_type: existing?.source_type ?? source.source_type ?? null,
                mentions: (existing?.mentions ?? 0) + 1,
            })
        }
    }

    return Array.from(map.values())
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, 8)
}

function competitorEvidence(chats: ArticleChat[], brandName: string): GeoArticleCompetitorEvidence[] {
    const map = new Map<string, { count: number; positions: number[]; sentiments: number[] }>()

    for (const chat of chats) {
        const seen = new Set<string>()
        for (const mention of chat.brand_mentions) {
            const name = mention.brand_name.trim()
            if (!name || name.toLowerCase() === brandName.toLowerCase()) continue
            if (seen.has(name.toLowerCase())) continue
            seen.add(name.toLowerCase())

            const existing = map.get(name) ?? { count: 0, positions: [], sentiments: [] }
            existing.count += 1
            if (mention.position !== null) existing.positions.push(mention.position)
            if (mention.sentiment_score !== null) existing.sentiments.push(mention.sentiment_score)
            map.set(name, existing)
        }
    }

    return Array.from(map.entries())
        .map(([name, data]) => ({
            name,
            visibility: chats.length ? round((data.count / chats.length) * 100) : 0,
            avg_position: avg(data.positions),
            avg_sentiment: avg(data.sentiments),
        }))
        .sort((a, b) => b.visibility - a.visibility)
        .slice(0, 5)
}

function answerPatterns(chats: ArticleChat[], brandName: string) {
    const samples = chats
        .filter(chat => chat.raw_response)
        .slice(0, 5)
        .map(chat => cleanText(chat.raw_response, 220))

    const patterns = new Set<string>()
    for (const sample of samples) {
        if (sample.toLowerCase().includes(brandName.toLowerCase())) {
            patterns.add(`AI answers already connect ${brandName} to this intent.`)
        }
        if (/best|top|leading/i.test(sample)) patterns.add("AI answers use shortlist/category language.")
        if (/compare|alternative|versus| vs /i.test(sample)) patterns.add("AI answers frame the topic as comparison research.")
        if (/source|citation|according|report|review/i.test(sample)) patterns.add("AI answers lean on external evidence and third-party sources.")
    }

    return [...patterns, ...samples.slice(0, 2)].slice(0, 5)
}

function parseGeneratedArticle(raw: string): GeoArticleResponse["article"] {
    const cleaned = raw
        .trim()
        .replace(/^```json\n?/i, "")
        .replace(/^```\n?/i, "")
        .replace(/\n?```$/i, "")
        .trim()

    return JSON.parse(cleaned) as GeoArticleResponse["article"]
}

async function buildBrief(input: GeoArticleInput, filters: DashboardFilters): Promise<{ brief: GeoArticleBrief; total: number }> {
    const project_id = input.project_id
    const offset = Math.max(0, input.offset ?? 0)
    const [project, opportunities] = await Promise.all([
        prisma.project.findUniqueOrThrow({
            where: { id: project_id },
            include: { competitors: true }
        }),
        getOpportunities(project_id, filters)
    ])

    const total = opportunities.opportunities.length
    // Wrap offset so it cycles through available opportunities
    const safeOffset = total > 0 ? offset % total : 0
    const selectedOpportunity = opportunities.opportunities[safeOffset]
    if (!selectedOpportunity) {
        throw new Error("NO_GEO_ARTICLE_OPPORTUNITY")
    }

    const chats = await loadArticleChats(project_id, {
        ...filters,
        prompt_id: selectedOpportunity.prompt_id
    })

    if (!chats.length) {
        throw new Error("NO_GEO_ARTICLE_EVIDENCE")
    }

    const ownMentionChats = chats.filter(chat => chat.brand_mentioned)
    const ownPosition = avg(ownMentionChats.map(chat => chat.brand_position).filter((value): value is number => value !== null))
    const ownSentiment = avg(ownMentionChats.map(chat => chat.sentiment_score).filter((value): value is number => value !== null))
    const competitors = competitorEvidence(chats, project.brand_name)
    const sources = sourceEvidence(chats)
    const prompt = chats[0].prompt
    const title = selectedOpportunity.content_gap.suggested_title || fallbackTitle(prompt.text, project.brand_name)

    const intent = inferIntent(prompt.text)

    const partialBrief = {
        brand: {
            name: project.brand_name,
            url: project.brand_url,
            location: project.brand_location,
        },
        topic: prompt.topic,
        geo_country: input?.geo_country ?? null,
        target_prompt: {
            id: prompt.id,
            text: prompt.text,
            type: prompt.type,
        },
        recommended_article: {
            title,
            content_type: selectedOpportunity.content_gap.recommended_content_type,
            action: selectedOpportunity.content_gap.action,
            priority_reason: selectedOpportunity.content_gap.priority_reason,
            target_intent: intent,
            suggested_slug: slugify(title),
        },
        metrics: {
            own_visibility: round((ownMentionChats.length / chats.length) * 100),
            own_avg_position: ownPosition ? round(ownPosition) : null,
            own_avg_sentiment: ownSentiment ? round(ownSentiment) : null,
            evidence_count: chats.length,
            days_analyzed: filters.days ?? 14,
        },
        competitors,
        sources_to_reference: sources,
        answer_patterns: answerPatterns(chats, project.brand_name),
        missing_angles: selectedOpportunity.content_gap.missing_angles,
    }

    return {
        brief: {
            ...partialBrief,
            outline: buildOutline(partialBrief),
            faqs: buildFaqs(prompt.text, project.brand_name, competitors, intent),
        },
        total,
    }
}

export async function getGeoArticle(input: GeoArticleInput): Promise<GeoArticleResponse> {
    const requestedDays = input.days ?? 14
    const baseFilters: DashboardFilters = {
        days: requestedDays,
        topic: input.topic,
        prompt_id: input.prompt_id,
        model: input.model,
    }

    let result = await buildBrief(input, baseFilters)

    if (result.brief.metrics.evidence_count < 20 && requestedDays < 30 && !input.prompt_id) {
        result = await buildBrief(input, {
            ...baseFilters,
            days: 30,
        })
    }

    const { brief, total } = result
    const system = buildGeoArticleSystemPrompt()
    const user = buildGeoArticleUserPrompt(brief)

    if (input.generate === false) {
        return {
            status: "BRIEF_ONLY",
            brief,
            total_opportunities: total,
            current_offset: input.offset ?? 0,
            article: null,
            prompt_used: { system, user }
        }
    }

    try {
        const raw = await generateText(system, user)
        return {
            status: "GENERATED",
            brief,
            total_opportunities: total,
            current_offset: input.offset ?? 0,
            article: parseGeneratedArticle(raw),
            prompt_used: { system, user }
        }
    } catch (error) {
        return {
            status: "BRIEF_ONLY",
            brief,
            total_opportunities: total,
            current_offset: input.offset ?? 0,
            article: null,
            generation_error: error instanceof Error ? error.message : "Failed to generate article",
            prompt_used: { system, user }
        }
    }
}
