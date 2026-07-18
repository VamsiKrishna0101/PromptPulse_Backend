import type { EngineConfig } from "../types"
import { buildIndexedInput } from "./common"

export const copilotConfig: EngineConfig = {
    engine: "copilot",
    defaultUrl: "https://copilot.microsoft.com/chats",
    scraperEnvName: "BRIGHT_DATA_COPILOT_SCRAPER_ID",
    urlEnvName: "BRIGHT_DATA_COPILOT_URL",
    buildInput: buildIndexedInput,
}
