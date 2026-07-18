export type UiEngine = "chatgpt" | "gemini" | "perplexity" | "google_ai_overview" | "google_ai_mode" | "copilot"

export type UiCitation = {
    text: string
    url: string
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
