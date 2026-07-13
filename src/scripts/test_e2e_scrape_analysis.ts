import "dotenv/config"
import axios from "axios"
import { analyzeResponse } from "../features/llm/gemini_service"
import { hasBedrockGateway } from "../features/llm/bedrock_gateway_service"

type ScrapeResult = {
    engine: string
    prompt: string
    status: string
    result_source?: string
    answer_text?: string
    citations?: { url?: string; text?: string; title?: string; domain?: string }[]
    error?: string | null
    attempts?: unknown[]
    artifacts?: {
        screenshot_path?: string | null
        html_path?: string | null
    }
}

const baseUrl = (process.env.SCRAPER_API_URL ?? "http://127.0.0.1:8002").replace(/\/$/, "")
const brandName = process.env.E2E_TEST_BRAND_NAME ?? "Refractone"
const brandUrl = process.env.E2E_TEST_BRAND_URL ?? "https://refractone.com"
const engine = process.env.E2E_TEST_ENGINE ?? "gemini"
const prompt = process.env.E2E_TEST_PROMPT ??
    "Which AI visibility platforms should a B2B SaaS team compare for tracking brand mentions across ChatGPT, Gemini, and Perplexity?"

async function main() {
    if (!hasBedrockGateway()) {
        throw new Error("Bedrock gateway is not configured for the post-scrape analysis step.")
    }

    const health = await axios.get(`${baseUrl}/scraping-engine/health`, { timeout: 10_000 })
    const scrapeStartedAt = Date.now()
    const scrapeResponse = await axios.post<ScrapeResult>(
        `${baseUrl}/scraping-engine/run-test`,
        {
            prompt,
            engine,
            geo: process.env.E2E_TEST_GEO ?? "US",
            fallback_policy: process.env.E2E_TEST_FALLBACK_POLICY ?? "never",
            use_proxy: process.env.E2E_TEST_USE_PROXY === "true",
            save_artifacts: process.env.E2E_TEST_SAVE_ARTIFACTS !== "false",
            max_retries: Number(process.env.E2E_TEST_MAX_RETRIES ?? 0),
        },
        { timeout: Number(process.env.E2E_TEST_TIMEOUT_MS ?? 180000) }
    )

    const scrape = scrapeResponse.data
    const answerText = scrape.answer_text?.trim() ?? ""
    if (scrape.status !== "success" && scrape.status !== "fallback_api_used") {
        throw new Error(`Scrape failed with status=${scrape.status}; error=${scrape.error ?? "none"}`)
    }
    if (!answerText) {
        throw new Error("Scrape succeeded but returned empty answer_text.")
    }

    const analysisStartedAt = Date.now()
    const analysis = await analyzeResponse(
        answerText,
        `${scrape.engine}-${scrape.result_source ?? "ui"}`,
        brandName,
        brandUrl,
        scrape.citations ?? []
    )

    console.log(JSON.stringify({
        ok: true,
        base_url: baseUrl,
        agents_health: health.data,
        sample_prompt: prompt,
        raw_response: answerText,
        raw_citations: (scrape.citations ?? []).map(citation => ({
            title: citation.title ?? citation.text ?? null,
            url: citation.url ?? null,
            domain: citation.domain ?? null,
        })),
        scrape: {
            engine: scrape.engine,
            status: scrape.status,
            result_source: scrape.result_source,
            elapsed_ms: Date.now() - scrapeStartedAt,
            answer_length: answerText.length,
            citation_count: scrape.citations?.length ?? 0,
            attempts: Array.isArray(scrape.attempts) ? scrape.attempts.length : 0,
            screenshot_path: scrape.artifacts?.screenshot_path ?? null,
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
