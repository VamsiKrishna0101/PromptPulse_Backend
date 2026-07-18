import "../lib/env"
import { analyzeResponse } from "../features/llm/gemini_service"
import { hasBedrockGateway } from "../features/llm/bedrock_gateway_service"
import { runUiScrape, type UiEngine } from "../features/scraping/scraper_api_client"

const supportedEngines = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "google_ai_mode", "copilot"] as const
const requestedEngine = (process.env.E2E_TEST_ENGINE ?? "gemini").trim().toLowerCase()
const engine: UiEngine = supportedEngines.includes(requestedEngine as UiEngine)
    ? requestedEngine as UiEngine
    : "gemini"

const brandName = process.env.E2E_TEST_BRAND_NAME ?? "PromptPulse"
const brandUrl = process.env.E2E_TEST_BRAND_URL ?? "https://promptpulse.com"
const geo = process.env.E2E_TEST_GEO ?? "US"
const prompt = process.env.E2E_TEST_PROMPT ??
    "Which AI visibility platforms should a B2B SaaS team compare for tracking brand mentions across ChatGPT, Gemini, and Perplexity?"

async function main() {
    if (!hasBedrockGateway()) {
        throw new Error("Bedrock gateway is not configured for the post-scrape analysis step.")
    }

    const scrapeStartedAt = Date.now()
    const scrape = await runUiScrape({ engine, prompt, geo })
    const answerText = scrape.answer_text?.trim() ?? ""

    if (scrape.status !== "success") {
        throw new Error(`Scrape failed with status=${scrape.status}; error=${scrape.error_reason ?? "none"}`)
    }
    if (!answerText) {
        throw new Error("Scrape succeeded but returned empty answer_text.")
    }

    const analysisStartedAt = Date.now()
    const analysis = await analyzeResponse(
        answerText,
        scrape.model_label,
        brandName,
        brandUrl,
        scrape.citations
    )

    console.log(JSON.stringify({
        ok: true,
        provider: "brightdata-with-api-fallback",
        sample_prompt: prompt,
        raw_response: answerText,
        raw_citations: scrape.citations,
        scrape: {
            engine: scrape.engine,
            status: scrape.status,
            model_label: scrape.model_label,
            elapsed_ms: Date.now() - scrapeStartedAt,
            answer_length: answerText.length,
            citation_count: scrape.citations.length,
            screenshot_path: scrape.screenshot_path,
            error: scrape.error_reason,
        },
        analysis: {
            provider: "bedrock",
            elapsed_ms: Date.now() - analysisStartedAt,
            brand_mentioned: analysis.brand_mentioned,
            brand_position: analysis.brand_position,
            sentiment_score: analysis.sentiment_score,
            brand_mentions: analysis.brand_mentions.map(mention => ({
                brand_name: mention.brand_name,
                domain: mention.domain,
                position: mention.position,
                sentiment_score: mention.sentiment_score,
            })),
            sources: analysis.sources.map(source => ({
                domain: source.domain,
                source_type: source.source_type,
                is_cited: source.is_cited,
            })),
        },
    }, null, 2))
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
