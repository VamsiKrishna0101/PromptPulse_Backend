import { contentTypeForIntent, funnelFromTags, intentFromTags, mapPromptToPage } from "./seo_keyword_mapper"
import type { SeoKeywordOpportunity } from "./seo_intelligence_types"

type PromptLike = {
    id: string
    text: string
    topic: string
    tags: string[]
    priority_score: number | null
    chats: { brand_mentioned: boolean; brand_position: number | null }[]
}

type PageLike = {
    url: string
    title: string | null
    h1: string | null
    word_count: number
    page_type: string
}

function average(values: number[]) {
    if (!values.length) return null
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
}

function aiVisibility(chats: PromptLike["chats"]) {
    if (!chats.length) return null
    return Math.round((chats.filter(chat => chat.brand_mentioned).length / chats.length) * 1000) / 10
}

function recommendationFor(input: { coverage: string; intent: string; promptText: string; pageUrl: string | null }) {
    if (input.coverage === "GAP") {
        return `Create a ${contentTypeForIntent(input.intent).toLowerCase()} that directly answers this query with proof, FAQs, location/service language, and schema.`
    }
    if (input.coverage === "WEAK") {
        return "Improve the mapped page with clearer title/H1, deeper answer copy, FAQs, trust proof, internal links, and schema."
    }
    return "Page coverage exists. Track AI visibility and connect Google SERP tracking to monitor organic rank."
}

export function buildSeoKeywordOpportunities(input: {
    prompts: PromptLike[]
    pages: PageLike[]
    rankByKeyword?: Map<string, { google_rank: number | null; ranking_url: string | null; ranking_title: string | null; related_queries: string[] }>
}): SeoKeywordOpportunity[] {
    return input.prompts
        .map(prompt => {
            const intent = intentFromTags(prompt.tags)
            const mapped = mapPromptToPage(prompt.text, input.pages)
            const rank = input.rankByKeyword?.get(prompt.text)
            const googleRankStatus: SeoKeywordOpportunity["google_rank_status"] = rank
                ? rank.google_rank === null ? "NOT_FOUND" : "FOUND"
                : "NOT_CONFIGURED"
            const positions = prompt.chats.map(chat => chat.brand_position).filter((value): value is number => typeof value === "number")
            return {
                id: `keyword:${prompt.id}`,
                prompt_id: prompt.id,
                keyword: prompt.text,
                topic: prompt.topic,
                intent,
                funnel: funnelFromTags(prompt.tags),
                priority_score: Math.round(prompt.priority_score ?? 50),
                seo_coverage: mapped.coverage,
                mapped_page_url: mapped.page?.url ?? null,
                mapped_page_title: mapped.page?.title ?? mapped.page?.h1 ?? null,
                ai_visibility: aiVisibility(prompt.chats),
                ai_avg_position: average(positions),
                google_rank: rank?.google_rank ?? null,
                google_rank_status: googleRankStatus,
                google_ranking_url: rank?.ranking_url ?? null,
                google_ranking_title: rank?.ranking_title ?? null,
                related_queries: rank?.related_queries ?? [],
                recommendation: recommendationFor({
                    coverage: mapped.coverage,
                    intent,
                    promptText: prompt.text,
                    pageUrl: mapped.page?.url ?? null,
                }),
            }
        })
        .sort((a, b) => {
            const coverageWeight = { GAP: 3, WEAK: 2, COVERED: 1 }
            return coverageWeight[b.seo_coverage] - coverageWeight[a.seo_coverage] || b.priority_score - a.priority_score
        })
        .slice(0, 30)
}
