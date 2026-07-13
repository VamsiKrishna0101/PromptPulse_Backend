import "dotenv/config"
import axios from "axios"

type ScrapeStatus =
    | "success"
    | "failed"
    | "timeout"
    | "blocked"
    | "login_required"
    | "captcha_required"
    | "fallback_api_used"
    | "fallback_api_failed"

type ScrapeResult = {
    engine: string
    prompt: string
    status: ScrapeStatus
    result_source?: string
    answer_text?: string
    citations?: unknown[]
    error?: string | null
    attempts?: unknown[]
    artifacts?: {
        screenshot_path?: string | null
        html_path?: string | null
    }
}

const baseUrl = (process.env.SCRAPER_API_URL ?? "http://127.0.0.1:8002").replace(/\/$/, "")
const engine = process.env.SCRAPE_TEST_ENGINE ?? "perplexity"
const prompt = process.env.SCRAPE_TEST_PROMPT ?? "What are the best AI visibility tools for B2B SaaS teams?"
const timeoutMs = Number(process.env.SCRAPE_TEST_TIMEOUT_MS ?? 180000)

async function main() {
    const health = await axios.get(`${baseUrl}/scraping-engine/health`, { timeout: 10_000 })
    if (health.data?.event_loop && health.data.event_loop !== "ProactorEventLoop") {
        throw new Error(`Agents API is using ${health.data.event_loop}; Playwright on Windows needs ProactorEventLoop.`)
    }

    const startedAt = Date.now()
    const response = await axios.post<ScrapeResult>(
        `${baseUrl}/scraping-engine/run-test`,
        {
            prompt,
            engine,
            geo: process.env.SCRAPE_TEST_GEO ?? "US",
            fallback_policy: process.env.SCRAPE_TEST_FALLBACK_POLICY ?? "never",
            use_proxy: process.env.SCRAPE_TEST_USE_PROXY === "true",
            save_artifacts: process.env.SCRAPE_TEST_SAVE_ARTIFACTS !== "false",
            max_retries: Number(process.env.SCRAPE_TEST_MAX_RETRIES ?? 0),
        },
        { timeout: timeoutMs }
    )

    const result = response.data
    const answerLength = result.answer_text?.length ?? 0
    const citationCount = Array.isArray(result.citations) ? result.citations.length : 0

    console.log(JSON.stringify({
        ok: result.status === "success" || result.status === "fallback_api_used",
        base_url: baseUrl,
        agents_health: health.data,
        elapsed_ms: Date.now() - startedAt,
        engine: result.engine,
        status: result.status,
        result_source: result.result_source,
        answer_length: answerLength,
        citation_count: citationCount,
        attempts: Array.isArray(result.attempts) ? result.attempts.length : 0,
        error: result.error || null,
        screenshot_path: result.artifacts?.screenshot_path ?? null,
    }, null, 2))

    if (result.status !== "success" && result.status !== "fallback_api_used") {
        process.exitCode = 1
    }
}

main().catch(error => {
    if (axios.isAxiosError(error)) {
        console.error(JSON.stringify({
            ok: false,
            message: error.message,
            status: error.response?.status ?? null,
            data: error.response?.data ?? null,
            base_url: baseUrl,
        }, null, 2))
    } else {
        console.error(error instanceof Error ? error.message : error)
    }
    process.exitCode = 1
})
