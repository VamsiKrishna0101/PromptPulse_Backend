import { Engine } from "@prisma/client"

export const ACTIVE_SCRAPE_ENGINES: readonly Engine[] = [
    Engine.CHATGPT,
    Engine.GEMINI,
    Engine.PERPLEXITY,
    Engine.GOOGLE_AI_MODE,
    Engine.COPILOT,
]

const activeEngineSet = new Set<Engine>(ACTIVE_SCRAPE_ENGINES)

export function isActiveScrapeEngine(engine: Engine): boolean {
    return activeEngineSet.has(engine)
}

export function activeConfiguredEngines(): Engine[] {
    return ACTIVE_SCRAPE_ENGINES.filter(engine => (
        engine !== Engine.COPILOT || Boolean(process.env.BRIGHT_DATA_COPILOT_SCRAPER_ID?.trim())
    ))
}
