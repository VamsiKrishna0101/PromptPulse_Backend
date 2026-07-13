export type OpportunityType = "MISSING" | "OUTRANKED" | "SOURCE_GAP" | "SENTIMENT_GAP"
export type OpportunityImpact = "HIGH" | "MEDIUM" | "LOW"
export type OpportunityEffort = "LOW" | "MEDIUM" | "HIGH"

export interface OpportunitySource {
    domain: string
    title: string | null
    source_type: string | null
    mentions: number
}

export interface ContentGapPlan {
    gap_reason: string
    recommended_content_type: string
    suggested_title: string
    action: "CREATE" | "REFRESH" | "OPTIMIZE"
    priority_reason: string
    missing_angles: string[]
    optimization_focus: string[]
}

export interface OpportunityItem {
    id: string
    type: OpportunityType
    title: string
    description: string
    prompt_id: string
    prompt_text: string
    topic: string | null
    competitor_name: string
    own_visibility: number
    competitor_visibility: number
    own_position: number | null
    competitor_position: number | null
    own_sentiment: number | null
    competitor_sentiment: number | null
    impact_score: number
    impact: OpportunityImpact
    effort: OpportunityEffort
    evidence_count: number
    top_sources: OpportunitySource[]
    content_gap: ContentGapPlan
    next_step: string
    sample_response: string | null
}

export interface OpportunitiesResponse {
    summary: {
        total: number
        high_impact: number
        quick_wins: number
        create_pages: number
        refresh_pages: number
        competitor_gaps: number
        source_gaps: number
        sentiment_gaps: number
    }
    opportunities: OpportunityItem[]
}
