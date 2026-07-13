export type GeoArticleStatus = "GENERATED" | "BRIEF_ONLY"

export interface GeoArticleEvidenceSource {
    domain: string
    title: string | null
    url: string | null
    source_type: string | null
    mentions: number
}

export interface GeoArticleCompetitorEvidence {
    name: string
    visibility: number
    avg_position: number | null
    avg_sentiment: number | null
}

export interface GeoArticleBrief {
    brand: {
        name: string
        url: string
        location: string
    }
    topic: string
    geo_country?: string | null
    target_prompt: {
        id: string
        text: string
        type: string
    }
    recommended_article: {
        title: string
        content_type: string
        action: "CREATE" | "REFRESH" | "OPTIMIZE"
        priority_reason: string
        target_intent: string
        suggested_slug: string
    }
    metrics: {
        own_visibility: number
        own_avg_position: number | null
        own_avg_sentiment: number | null
        evidence_count: number
        days_analyzed: number
    }
    competitors: GeoArticleCompetitorEvidence[]
    sources_to_reference: GeoArticleEvidenceSource[]
    answer_patterns: string[]
    missing_angles: string[]
    outline: string[]
    /** FAQ seed questions — the LLM expands these into {question, answer} pairs in the article */
    faqs: string[]
}

export interface GeoArticleResponse {
    status: GeoArticleStatus
    saved_content_brief_id?: string
    brief: GeoArticleBrief
    article: {
        title: string
        meta_description: string
        slug: string
        target_query: string
        search_intent: string
        article_markdown: string
        faq: { question: string; answer: string }[]
        json_ld: string
        needs_data: string[]
    } | null
    total_opportunities: number
    current_offset: number
    generation_error?: string
    prompt_used: {
        system: string
        user: string
    }
}

export interface SavedGeoArticleItem {
    id: string
    offset: number
    status: GeoArticleStatus
    brief: GeoArticleBrief
    article: GeoArticleResponse["article"]
    generation_error?: string | null
    created_at: Date
    updated_at: Date
}
