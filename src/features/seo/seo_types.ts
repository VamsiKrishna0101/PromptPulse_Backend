export type SeoSeverity = "HIGH" | "MEDIUM" | "LOW"
export type SeoCategory = "TECHNICAL" | "AI_READINESS" | "LOCAL" | "CONTENT" | "SCHEMA" | "SOURCE"
export type SeoActionPriority = "HIGH" | "MEDIUM" | "LOW"
export type SeoActionDifficulty = "LOW" | "MEDIUM" | "HIGH"

export type CrawledSeoPage = {
    url: string
    status_code: number | null
    html: string
    title: string | null
    meta_description: string | null
    h1: string | null
    canonical: string | null
    word_count: number
    indexable: boolean
    has_viewport: boolean
    has_schema: boolean
    has_faq: boolean
    detected_services: string[]
    detected_locations: string[]
    page_type: string
    text: string
}

export type SeoIssueInput = {
    page_url?: string
    category: SeoCategory
    severity: SeoSeverity
    title: string
    description: string
    recommendation: string
    priority_score: number
}

export type SeoActionInput = {
    action_type: string
    title: string
    description: string
    page_url?: string | null
    priority: SeoActionPriority
    difficulty: SeoActionDifficulty
    related_prompt_ids?: string[]
    related_sources?: string[]
}

export type SeoScores = {
    overall_score: number
    technical_score: number
    ai_readiness_score: number
    local_score: number
    content_score: number
    schema_score: number
}
