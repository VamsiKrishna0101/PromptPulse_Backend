import "../lib/env"
import { runUiScrape, type UiEngine } from "../features/scraping/scraper_api_client"

const supportedEngines = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "google_ai_mode", "copilot"] as const
const engines = (process.env.ALL_SCRAPER_TEST_ENGINES ?? "chatgpt,gemini,perplexity,google_ai_overview,google_ai_mode,copilot")
    .split(",")
    .map(engine => engine.trim().toLowerCase())
    .filter((engine): engine is UiEngine => supportedEngines.includes(engine as UiEngine))

const prompt = process.env.ALL_SCRAPER_TEST_PROMPT ??
    "What are the best platforms for researching CEOs and leadership teams? Include free tools, professional databases, and executive intelligence services."
const geo = process.env.ALL_SCRAPER_TEST_GEO ?? "US"

function looksPossiblyTruncated(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return true
    if (!/[.!?)\]"'`]$/.test(trimmed)) return true

    const tail = trimmed.toLowerCase().split(/\s+/).slice(-4).join(" ")
    return [
        "and",
        "or",
        "with",
        "including",
        "such as",
        "for example",
        "because",
        "while",
        "via",
        "by",
    ].some(marker => tail.endsWith(marker))
}

async function runEngine(engine: UiEngine) {
    const startedAt = Date.now()
    const result = await runUiScrape({ engine, prompt, geo })
    const answer = result.answer_text?.trim() ?? ""

    return {
        engine,
        ok: result.status === "success",
        status: result.status,
        model_label: result.model_label,
        elapsed_ms: Date.now() - startedAt,
        answer_length: answer.length,
        possibly_truncated: looksPossiblyTruncated(answer),
        answer_tail: answer.slice(Math.max(0, answer.length - 360)),
        citation_count: result.citations.length,
        citations: result.citations.slice(0, 8),
        error: result.error_reason,
        screenshot_path: result.screenshot_path,
    }
}

async function main() {
    const results = []

    for (const engine of engines) {
        try {
            results.push(await runEngine(engine))
        } catch (error) {
            results.push({
                engine,
                ok: false,
                status: "failed",
                model_label: null,
                elapsed_ms: null,
                answer_length: 0,
                possibly_truncated: true,
                answer_tail: "",
                citation_count: 0,
                citations: [],
                error: error instanceof Error ? error.message : String(error),
                screenshot_path: null,
            })
        }
    }

    console.log(JSON.stringify({
        ok: results.every(result => result.ok && !result.possibly_truncated),
        provider: "brightdata-with-api-fallback",
        prompt,
        geo,
        engines,
        results,
    }, null, 2))

    if (results.some(result => !result.ok || result.possibly_truncated)) {
        process.exitCode = 1
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})
