import { runApiFallback } from "./brightdata/api_fallback"
import { runBrightDataScrape } from "./brightdata/client"
import type { UiEngine, UiScrapeResult } from "./brightdata/types"
import { normalizeErrorMessage } from "./brightdata/utils"

export type { UiCitation, UiEngine, UiScrapeResult } from "./brightdata/types"

export async function runUiScrape(input: {
    engine: UiEngine
    prompt: string
    profile?: string | null
    geo?: string | null
    proxySessionId?: string | null
}): Promise<UiScrapeResult> {
    const geo = (input.geo ?? process.env.SCRAPER_DEFAULT_GEO ?? "US").toUpperCase()
    const brightDataStart = Date.now()

    try {
        const brightDataResult = await runBrightDataScrape({
            engine: input.engine,
            prompt: input.prompt,
            geo,
        })

        if (brightDataResult.answer_text?.trim()) {
            return brightDataResult
        }

        return await runApiFallback(
            input.engine,
            input.prompt,
            geo,
            "Bright Data returned no answer text."
        )
    } catch (error) {
        const reason = normalizeErrorMessage(error)
        if (isBrightDataValidationError(reason)) {
            console.error(
                `[brightdata-error] ${input.engine}/${geo} VALIDATION ERROR after ${Date.now() - brightDataStart}ms: ${reason}`
            )
            return {
                engine: input.engine,
                prompt: input.prompt,
                status: "failed",
                answer_text: null,
                citations: [],
                screenshot_path: null,
                model_label: `${input.engine}-brightdata-validation-failed`,
                error_reason: reason,
                raw_text: null,
                retry_count: 0,
                created_at: new Date().toISOString(),
            }
        }

        console.error(
            `[brightdata-error] ${input.engine}/${geo} FAILED after ${Date.now() - brightDataStart}ms: ${reason}`
        )
        return await runApiFallback(input.engine, input.prompt, geo, reason)
    }
}

function isBrightDataValidationError(reason: string) {
    return reason.includes("status=400")
        && (reason.includes("validation_error") || reason.includes("Invalid input provided"))
}
