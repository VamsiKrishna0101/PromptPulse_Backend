import type { EngineConfig } from "../types"
import { buildIndexedInput } from "./common"

export const PERPLEXITY_SEARCH_SCRAPER_ID = "gd_m7dhdot1vw9a7gc1n"

export const perplexityConfig: EngineConfig = {
    engine: "perplexity",
    defaultUrl: "https://www.perplexity.ai/",
    defaultScraperId: PERPLEXITY_SEARCH_SCRAPER_ID,
    scraperEnvName: "BRIGHT_DATA_PERPLEXITY_SCRAPER_ID",
    urlEnvName: "BRIGHT_DATA_PERPLEXITY_URL",
    buildInput: params => {
        const payload = buildIndexedInput(params)
        payload.export_markdown_file = process.env.BRIGHT_DATA_PERPLEXITY_EXPORT_MARKDOWN_FILE !== "false"
        return payload
    },
}
