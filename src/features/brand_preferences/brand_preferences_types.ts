export type BrandPreferencePayload = {
    industry_category: string
    buyer_persona?: string | null
    keywords: string[]
    avoid_keywords: string[]
    competitor_context?: string | null
    reddit_focus: string[]
}
