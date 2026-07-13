import "dotenv/config"
import axios from "axios"

type Engine = "chatgpt" | "gemini" | "perplexity" | "google_ai_overview" | "google_ai_mode"

type ScrapeResult = {
    engine: Engine
    prompt: string
    status: string
    result_source?: string
    answer_text?: string
    citations?: { url?: string | null; text?: string | null; title?: string | null; domain?: string | null }[]
    error?: string | null
    attempts?: unknown[]
    artifacts?: {
        screenshot_path?: string | null
        html_path?: string | null
    }
}

const baseUrl = (process.env.SCRAPER_API_URL ?? "http://127.0.0.1:8002").replace(/\/$/, "")
const supportedEngines = ["chatgpt", "gemini", "perplexity", "google_ai_overview", "google_ai_mode"] as const

const engines = (process.env.ALL_SCRAPER_TEST_ENGINES ?? "chatgpt,gemini,perplexity,google_ai_overview,google_ai_mode")
    .split(",")
    .map(engine => engine.trim().toLowerCase())
    .filter((engine): engine is Engine => supportedEngines.includes(engine as Engine))

const prompt = process.env.ALL_SCRAPER_TEST_PROMPT ??
    "What are the best platforms for researching CEOs and leadership teams? Include free tools, professional databases, and executive intelligence services."

const knownPlatforms = [
    "LinkedIn",
    "LinkedIn Sales Navigator",
    "Crunchbase",
    "PitchBook",
    "ZoomInfo",
    "Apollo.io",
    "The Org",
    "Owler",
    "Bloomberg",
    "Reuters",
    "SEC EDGAR",
    "TIKR",
    "BoardEx",
    "Altrata",
    "Equilar",
    "S&P Capital IQ",
    "Capital IQ",
    "Orbis",
    "Bureau van Dijk",
    "FactSet",
    "Dun & Bradstreet",
    "D&B Hoovers",
    "Pineify",
    "UpLead",
    "Amplemarket",
    "Cisive",
    "Verata",
    "Leadership Connect",
    "Boardroom Alpha",
]

function looksPossiblyTruncated(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return true
    if (!/[.!?)\]"'”’`]$/.test(trimmed)) return true

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

function mentionedPlatforms(answer: string, citations: ScrapeResult["citations"] = []) {
    const haystack = `${answer}\n${citations.map(citation => `${citation.title ?? ""} ${citation.domain ?? ""} ${citation.url ?? ""}`).join("\n")}`.toLowerCase()
    return knownPlatforms.filter(platform => {
        const normalized = platform.toLowerCase()
        const compact = normalized.replace(/[^a-z0-9]/g, "")
        return haystack.includes(normalized) || haystack.replace(/[^a-z0-9]/g, "").includes(compact)
    })
}

async function runEngine(engine: Engine) {
    const startedAt = Date.now()
    const response = await axios.post<ScrapeResult>(
        `${baseUrl}/scraping-engine/run-test`,
        {
            prompt,
            engine,
            geo: process.env.ALL_SCRAPER_TEST_GEO ?? "US",
            fallback_policy: process.env.ALL_SCRAPER_TEST_FALLBACK_POLICY ?? "never",
            use_proxy: process.env.ALL_SCRAPER_TEST_USE_PROXY === "true",
            save_artifacts: process.env.ALL_SCRAPER_TEST_SAVE_ARTIFACTS !== "false",
            max_retries: Number(process.env.ALL_SCRAPER_TEST_MAX_RETRIES ?? 0),
        },
        { timeout: Number(process.env.ALL_SCRAPER_TEST_TIMEOUT_MS ?? 300000) }
    )

    const result = response.data
    const answer = result.answer_text?.trim() ?? ""
    const citations = result.citations ?? []
    return {
        engine,
        ok: result.status === "success" || result.status === "fallback_api_used",
        status: result.status,
        result_source: result.result_source ?? null,
        elapsed_ms: Date.now() - startedAt,
        answer_length: answer.length,
        possibly_truncated: looksPossiblyTruncated(answer),
        mentioned_platforms: mentionedPlatforms(answer, citations),
        answer_tail: answer.slice(Math.max(0, answer.length - 360)),
        citation_count: citations.length,
        citation_domains: [...new Set(citations.map(citation => citation.domain).filter(Boolean))],
        citations: citations.slice(0, 8).map(citation => ({
            title: citation.title ?? citation.text ?? null,
            domain: citation.domain ?? null,
            url: citation.url ?? null,
        })),
        attempts: Array.isArray(result.attempts) ? result.attempts.length : 0,
        error: result.error ?? null,
        screenshot_path: result.artifacts?.screenshot_path ?? null,
    }
}

async function main() {
    const health = await axios.get(`${baseUrl}/scraping-engine/health`, { timeout: 10_000 })
    const results = []

    for (const engine of engines) {
        try {
            results.push(await runEngine(engine))
        } catch (error) {
            if (axios.isAxiosError(error)) {
                results.push({
                    engine,
                    ok: false,
                    status: "request_failed",
                    result_source: null,
                    elapsed_ms: null,
                    answer_length: 0,
                    possibly_truncated: true,
                    answer_tail: "",
                    citation_count: 0,
                    citations: [],
                    attempts: 0,
                    error: error.response?.data ?? error.message,
                    screenshot_path: null,
                })
            } else {
                results.push({
                    engine,
                    ok: false,
                    status: "failed",
                    result_source: null,
                    elapsed_ms: null,
                    answer_length: 0,
                    possibly_truncated: true,
                    answer_tail: "",
                    citation_count: 0,
                    citations: [],
                    attempts: 0,
                    error: error instanceof Error ? error.message : String(error),
                    screenshot_path: null,
                })
            }
        }
    }

    console.log(JSON.stringify({
        ok: results.every(result => result.ok && !result.possibly_truncated),
        base_url: baseUrl,
        agents_health: health.data,
        prompt,
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
