export type BrandResearchInput = {
    brand_url: string
    brand_name: string
}

export type BrandResearchOutput = {
    brand_name: string
    brand_url: string
    run_id?: string
    research_source?: 'website_crawler' | 'firecrawl_fallback' | 'parallel_fallback'
    crawler_source?: 'website_crawler' | 'firecrawl_fallback'
    pages_crawled?: number
    important_links?: string[]
    social_links?: string[]
    crawler_notes?: string[]
    crawler_error?: string
    summary_error?: string
    data: {
        tagline: string | null
        description: string
        industry: string
        founded: string | null
        headquarters: string | null
        employee_count: string | null
        business_model: string
        target_audience: string
        key_products_services: string
        pricing_model: string | null
        competitors: string
        recent_news_or_updates: string | null
        social_presence: string | null
        tone_and_brand_voice: string
        unique_value_proposition: string
    }
}

export type PromptInput = {
    brand_name: string
    brand_url: string
    brand_data: Record<string, unknown>
}

export type CreateProjectInput = {
    user_id: string
    brand_name: string
    brand_url: string
    brand_location: string
    competitors: string[]
    prompts: {
        topic: string
        type: string
        text: string
        selected: boolean
        source?: 'GENERATED' | 'CUSTOMER'
    }[]
}
