import "../lib/env"
import { runUiScrape, type UiEngine } from "../features/scraping/scraper_api_client"

const supportedEngines = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "google_ai_mode", "copilot"] as const
const requestedEngine = (process.env.SCRAPE_TEST_ENGINE ?? "chatgpt").trim().toLowerCase()
const engine: UiEngine = supportedEngines.includes(requestedEngine as UiEngine)
    ? requestedEngine as UiEngine
    : "chatgpt"

const prompt = process.env.SCRAPE_TEST_PROMPT ?? "What are the best AI visibility tools for B2B SaaS teams?"
const geo = process.env.SCRAPE_TEST_GEO ?? "US"

async function main() {
    const startedAt = Date.now()
    const result = await runUiScrape({ engine, prompt, geo })
    const answerText = result.answer_text?.trim() ?? ""

    console.log(JSON.stringify({
        ok: result.status === "success",
        elapsed_ms: Date.now() - startedAt,
        engine: result.engine,
        geo,
        status: result.status,
        model_label: result.model_label,
        answer_length: answerText.length,
        citation_count: result.citations.length,
        error: result.error_reason,
        screenshot_path: result.screenshot_path,
        answer_preview: answerText.slice(0, Number(process.env.SCRAPE_TEST_ANSWER_PREVIEW_CHARS ?? 800)) || null,
    }, null, 2))

    if (process.env.SCRAPE_TEST_PRINT_ANSWER === "true" && answerText) {
        console.log("\n--- ANSWER_TEXT ---\n")
        console.log(answerText)
        console.log("\n--- END_ANSWER_TEXT ---")
    }

    if (result.status !== "success") {
        process.exitCode = 1
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
