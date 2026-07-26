export type SeoCoverageStatus = "COVERED" | "WEAK" | "GAP"

export type SeoKeywordOpportunity = {
    id: string
    prompt_id: string
    keyword: string
    topic: string
    intent: string
    funnel: string
    priority_score: number
    seo_coverage: SeoCoverageStatus
    mapped_page_url: string | null
    mapped_page_title: string | null
    ai_visibility: number | null
    ai_avg_position: number | null
    google_rank: number | null
    google_rank_status: "NOT_CONFIGURED" | "FOUND" | "NOT_FOUND"
    google_ranking_url: string | null
    google_ranking_title: string | null
    related_queries: string[]
    recommendation: string
}

export type SeoContentOpportunity = {
    id: string
    title: string
    description: string
    target_keyword: string
    recommended_page_type: string
    priority: "HIGH" | "MEDIUM" | "LOW"
    mapped_page_url: string | null
}

export type SeoLocalChecklistItem = {
    id: string
    label: string
    status: "PASS" | "NEEDS_WORK"
    reason: string
}

export type SeoRankTrackingSummary = {
    google_enabled: boolean
    message: string
    checked_keywords: number
}

export type SeoIntelligence = {
    keywords: SeoKeywordOpportunity[]
    content_opportunities: SeoContentOpportunity[]
    local_checklist: SeoLocalChecklistItem[]
    rank_tracking: SeoRankTrackingSummary
}
