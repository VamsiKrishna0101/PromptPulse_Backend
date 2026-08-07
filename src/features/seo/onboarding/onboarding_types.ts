export type OnboardingTier = "quick" | "standard" | "deep"

export type OnboardingInput = {
    tier?: OnboardingTier
    max_credits?: number
    country: string
    language_code?: string
    services?: string[]
    target_audience?: string
    goals?: string[]
    competitor_domains?: string[]
    max_pages?: number
    include_provider_research?: boolean
    include_backlinks?: boolean
    run_ai_visibility?: boolean
    ai_prompt_count?: number
}

export type WebsitePageProbe = {
    url: string
    status: number | null
    title: string | null
    meta_description: string | null
    h1: string | null
    internal_links: number
    word_count: number
}

export type WebsiteProbeResult = {
    homepage: WebsitePageProbe
    pages: WebsitePageProbe[]
    sitemap_url: string | null
    failed_urls: string[]
}
