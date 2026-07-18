import { chatGptConfig } from "./engines/chatgpt"
import { copilotConfig } from "./engines/copilot"
import { geminiConfig } from "./engines/gemini"
import { googleAiModeConfig, googleAiOverviewConfig } from "./engines/google"
import { perplexityConfig } from "./engines/perplexity"
import type { BrightDataInputPayload, EngineConfig, UiEngine } from "./types"
import { buildBrightDataInputIndex } from "./utils"

const ENGINE_CONFIGS: Record<UiEngine, EngineConfig> = {
    chatgpt: chatGptConfig,
    gemini: geminiConfig,
    perplexity: perplexityConfig,
    google_ai_overview: googleAiOverviewConfig,
    google_ai_mode: googleAiModeConfig,
    copilot: copilotConfig,
}

export function buildBrightDataInput(
    engine: UiEngine,
    prompt: string,
    geo: string,
    index = buildBrightDataInputIndex()
): BrightDataInputPayload {
    const config = getEngineConfig(engine)
    return config.buildInput({
        prompt,
        geo,
        url: getEngineUrl(engine),
        index,
    })
}

export function getScraperId(engine: UiEngine) {
    if (
        engine === "google_ai_overview"
        && process.env.BRIGHT_DATA_GOOGLE_AI_OVERVIEW_USE_AI_MODE !== "false"
    ) {
        const overviewId = process.env[googleAiOverviewConfig.scraperEnvName]?.trim()
        if (overviewId) return overviewId
        return process.env[googleAiModeConfig.scraperEnvName]?.trim() ?? googleAiModeConfig.defaultScraperId ?? ""
    }

    const config = getEngineConfig(engine)
    return process.env[config.scraperEnvName]?.trim() ?? config.defaultScraperId ?? ""
}

function getEngineUrl(engine: UiEngine) {
    const config = getEngineConfig(engine)
    return process.env[config.urlEnvName]?.trim() ?? config.defaultUrl
}

function getEngineConfig(engine: UiEngine) {
    return ENGINE_CONFIGS[engine]
}
