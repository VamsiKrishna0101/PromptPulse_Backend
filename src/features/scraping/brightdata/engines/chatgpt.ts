import { getBooleanEnv } from "../utils"
import type { EngineConfig } from "../types"

export const CHATGPT_SEARCH_SCRAPER_ID = "gd_m7aof0k82r803d5bjm"

export const chatGptConfig: EngineConfig = {
    engine: "chatgpt",
    defaultUrl: "https://chatgpt.com/",
    defaultScraperId: CHATGPT_SEARCH_SCRAPER_ID,
    scraperEnvName: "BRIGHT_DATA_CHATGPT_SCRAPER_ID",
    urlEnvName: "BRIGHT_DATA_CHATGPT_URL",
    buildInput: params => {
        // Keep payload aligned with BrightData's ChatGPT async scraper.
        // Country targeting is handled outside this payload when the scraper rejects
        // country in-body, but index is essential for batch result mapping.
        const payload: Record<string, unknown> = {
            url: params.url,
            prompt: params.prompt.slice(0, Number(process.env.BRIGHT_DATA_MAX_PROMPT_CHARS ?? 4096)),
            index: params.index,
        }

        payload.web_search = process.env.BRIGHT_DATA_WEB_SEARCH !== "false"
        payload.require_sources = getBooleanEnv(
            false,
            "BRIGHT_DATA_CHATGPT_REQUIRE_SOURCES",
            "BRIGHT_DATA_REQUIRE_SOURCES"
        )

        const additionalPrompt = process.env.BRIGHT_DATA_CHATGPT_ADDITIONAL_PROMPT?.trim()
        if (additionalPrompt) payload.additional_prompt = additionalPrompt

        return payload
    },
}
