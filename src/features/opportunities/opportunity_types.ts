export type OpportunityType = "MISSING" | "OUTRANKED" | "SOURCE_GAP" | "SENTIMENT_GAP"
export type OpportunityImpact = "HIGH" | "MEDIUM" | "LOW"
export type OpportunityEffort = "LOW" | "MEDIUM" | "HIGH"
export type OpportunityConfidence = "HIGH" | "MEDIUM" | "LOW" | "NEEDS_REVIEW"
export type SourceActionability = "HIGH" | "MEDIUM" | "LOW" | "NOT_ACTIONABLE"
export type OpportunityBucket = "QUICK_WIN" | "SOURCE_GAP" | "CONTENT_GAP" | "AUTHORITY_GAP" | "MONITOR"
export type RecommendationOutcome = "RECOMMENDED" | "LISTED" | "ABSENT" | "NEGATIVE"
export type BuyerIntentStage = "DISCOVERY" | "CONSIDERATION" | "DECISION" | "REPUTATION"
export type BuyerIntentValue = "HIGH" | "MEDIUM" | "LOW"

export interface OpportunitySource {
    domain: string
    url: string | null
    title: string | null
    source_type: string | null
    mentions: number
    citations: number
    avg_rank: number | null
    source_kind: string | null
    actionability: SourceActionability
    recommended_action: string
}

export interface ContentGapPlan {
    gap_reason: string
    recommended_content_type: string
    suggested_title: string
    action: "CREATE" | "REFRESH" | "OPTIMIZE"
    priority_reason: string
    missing_angles: string[]
    optimization_focus: string[]
    source_actions: string[]
}

export interface OpportunityItem {
    id: string
    type: OpportunityType
    title: string
    description: string
    prompt_id: string
    prompt_text: string
    topic: string | null
    buyer_intent: {
        key: string
        label: string
        stage: BuyerIntentStage
        value: BuyerIntentValue
        reason: string
    }
    competitor_name: string
    brand_outcome: RecommendationOutcome
    competitor_outcome: RecommendationOutcome
    outcome_explanation: string
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
    clean_evidence_count: number
    confidence: OpportunityConfidence
    confidence_reasons: string[]
    prompt_intent_warning: string | null
    opportunity_bucket: OpportunityBucket
    actionability: SourceActionability
    source_pattern: string | null
    top_sources: OpportunitySource[]
    content_gap: ContentGapPlan
    target_page: {
        status: "EXISTING_PAGE" | "NEW_PAGE" | "REVIEW"
        url: string | null
        label: string
        reason: string
    }
    supporting_urls: string[]
    business_reason: string
    verification: {
        baseline: {
            visibility: number
            position: number | null
            outcome: RecommendationOutcome
        }
        success_metric: string
        recheck_after_days: number
    }
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
