export type UiEngine = "chatgpt" | "gemini" | "perplexity" | "google_ai_overview" | "google_ai_mode" | "copilot"

export type UiCitation = {
    text: string
    url: string
    domain?: string | null
    snippet?: string | null
    position?: number | null
    answer_position?: number | null
    is_cited?: boolean
    source_kind?: "citation" | "search_source" | "search_source_more" | "attached_link" | "reference" | "source"
}

export type UiScrapeResult = {
    engine: UiEngine
    prompt: string
    status: "success" | "failed" | "manual_needed" | "rate_limited"
    answer_text: string | null
    citations: UiCitation[]
    screenshot_path: string | null
    model_label: string
    error_reason: string | null
    raw_text: string | null
    retry_count?: number
    created_at: string
}

export type BrightDataRecord = Record<string, unknown>

export type BrightDataInputPayload = Record<string, unknown>

export type BuildBrightDataInputParams = {
    prompt: string
    geo: string
    url: string
    index: number
}

export type EngineConfig = {
    engine: UiEngine
    defaultUrl: string
    scraperEnvName: string
    urlEnvName: string
    defaultScraperId?: string
    buildInput: (params: BuildBrightDataInputParams) => BrightDataInputPayload
}
