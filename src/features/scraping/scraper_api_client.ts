import axios from "axios"

export type UiEngine = "chatgpt" | "gemini" | "perplexity" | "google_ai_overview" | "google_ai_mode"

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

type LegacyUiScrapeResult = {
    raw_response?: string
    sources?: UiCitation[]
    ai_model?: string
    status: "success" | "failed" | "manual_needed" | "rate_limited"
    screenshot_path?: string | null
    error_reason?: string | null
    retry_count?: number
}

type AgentScrapeResult = {
    engine: UiEngine
    prompt: string
    status: "success" | "failed" | "timeout" | "blocked" | "login_required" | "captcha_required" | "fallback_api_used" | "fallback_api_failed"
    result_source?: "ui" | "api" | "mock"
    answer_text?: string
    citations?: {
        title?: string | null
        text?: string | null
        url?: string | null
        domain?: string | null
    }[]
    artifacts?: {
        screenshot_path?: string | null
    }
    error?: string | null
    attempts?: unknown[]
}

export async function runUiScrape(input: {
    engine: UiEngine
    prompt: string
    profile?: string | null
}) {
    const baseUrl = process.env.SCRAPER_API_URL ?? "http://127.0.0.1:8000"
    const response = await axios.post<UiScrapeResult | LegacyUiScrapeResult | AgentScrapeResult>(`${baseUrl}/scraping-engine/run-test`, {
        prompt: input.prompt,
        engine: input.engine,
        geo: "IN",
        fallback_policy: "on_failure",
        use_proxy: false,
        save_artifacts: true,
    }, {
        timeout: Number(process.env.SCRAPER_API_TIMEOUT_MS ?? 900000)
    })

    return normalizeUiScrapeResult(response.data, input.engine, input.prompt)
}

function normalizeUiScrapeResult(
    result: UiScrapeResult | LegacyUiScrapeResult,
    engine: UiEngine,
    prompt: string
): UiScrapeResult {
    if ("answer_text" in result) {
        if ("result_source" in result || "artifacts" in result || "attempts" in result) {
            return normalizeAgentScrapeResult(result as AgentScrapeResult, engine, prompt)
        }
        return result
    }

    return {
        engine,
        prompt,
        status: result.status,
        answer_text: result.raw_response ?? null,
        citations: result.sources ?? [],
        screenshot_path: result.screenshot_path ?? null,
        model_label: result.ai_model ?? `${engine}-ui`,
        error_reason: result.error_reason ?? null,
        raw_text: result.raw_response ?? null,
        retry_count: result.retry_count ?? 0,
        created_at: new Date().toISOString()
    }
}

function normalizeAgentScrapeResult(
    result: AgentScrapeResult,
    engine: UiEngine,
    prompt: string
): UiScrapeResult {
    const status = normalizeAgentStatus(result.status)

    return {
        engine,
        prompt,
        status,
        answer_text: result.answer_text || null,
        citations: (result.citations ?? [])
            .filter(citation => Boolean(citation.url || citation.text))
            .map(citation => ({
                text: citation.text || citation.title || citation.domain || citation.url || "Source",
                url: citation.url || "",
            })),
        screenshot_path: result.artifacts?.screenshot_path ?? null,
        model_label: `${engine}-${result.result_source ?? "ui"}`,
        error_reason: result.error ?? null,
        raw_text: result.answer_text || null,
        retry_count: Array.isArray(result.attempts) ? Math.max(0, result.attempts.length - 1) : 0,
        created_at: new Date().toISOString()
    }
}

function normalizeAgentStatus(status: AgentScrapeResult["status"]): UiScrapeResult["status"] {
    if (status === "success" || status === "fallback_api_used") return "success"
    if (status === "blocked" || status === "login_required" || status === "captcha_required") return "manual_needed"
    if (status === "timeout") return "rate_limited"
    return "failed"
}
