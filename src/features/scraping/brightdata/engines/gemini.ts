import type { EngineConfig } from "../types"
import { buildIndexedInput } from "./common"

export const geminiConfig: EngineConfig = {
    engine: "gemini",
    defaultUrl: "https://gemini.google.com/",
    scraperEnvName: "BRIGHT_DATA_GEMINI_SCRAPER_ID",
    urlEnvName: "BRIGHT_DATA_GEMINI_URL",
    buildInput: buildIndexedInput,
}
