import type { EngineConfig, UiEngine } from "../types"
import { buildBaseInput } from "./common"

export const GOOGLE_AI_MODE_SEARCH_SCRAPER_ID = "gd_mcswdt6z2elth3zqr2"

export const googleAiModeConfig: EngineConfig = {
    engine: "google_ai_mode",
    defaultUrl: "https://www.google.com/search?udm=50",
    defaultScraperId: GOOGLE_AI_MODE_SEARCH_SCRAPER_ID,
    scraperEnvName: "BRIGHT_DATA_GOOGLE_AI_MODE_SCRAPER_ID",
    urlEnvName: "BRIGHT_DATA_GOOGLE_AI_MODE_URL",
    buildInput: params => {
        const payload = buildBaseInput(params)
        payload.hl = getGoogleLanguage("google_ai_mode")
        return payload
    },
}

export const googleAiOverviewConfig: EngineConfig = {
    engine: "google_ai_overview",
    defaultUrl: "https://www.google.com/search",
    scraperEnvName: "BRIGHT_DATA_GOOGLE_AI_OVERVIEW_SCRAPER_ID",
    urlEnvName: "BRIGHT_DATA_GOOGLE_AI_OVERVIEW_URL",
    buildInput: params => {
        const payload = buildBaseInput(params)
        payload.hl = getGoogleLanguage("google_ai_overview")
        return payload
    },
}

function getGoogleLanguage(engine: UiEngine) {
    const engineSpecific = engine === "google_ai_mode"
        ? process.env.BRIGHT_DATA_GOOGLE_AI_MODE_HL
        : process.env.BRIGHT_DATA_GOOGLE_AI_OVERVIEW_HL

    return (engineSpecific ?? process.env.BRIGHT_DATA_GOOGLE_HL ?? "en").trim() || "en"
}
