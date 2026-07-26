import { contentTypeForIntent } from "./seo_keyword_mapper"
import type { SeoContentOpportunity, SeoKeywordOpportunity } from "./seo_intelligence_types"

export function buildSeoContentOpportunities(keywords: SeoKeywordOpportunity[]): SeoContentOpportunity[] {
    return keywords
        .filter(keyword => keyword.seo_coverage !== "COVERED")
        .slice(0, 12)
        .map(keyword => ({
            id: `content:${keyword.prompt_id}`,
            title: keyword.seo_coverage === "GAP" ? "Create new page" : "Improve existing page",
            description: keyword.recommendation,
            target_keyword: keyword.keyword,
            recommended_page_type: contentTypeForIntent(keyword.intent),
            priority: keyword.priority_score >= 80 || keyword.seo_coverage === "GAP" ? "HIGH" : "MEDIUM",
            mapped_page_url: keyword.mapped_page_url,
        }))
}
