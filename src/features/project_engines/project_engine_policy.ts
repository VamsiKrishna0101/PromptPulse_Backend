import { Engine, Plan } from "@prisma/client"
import { PLAN_LIMITS } from "../subscription/plan_config"

export const SELECTABLE_PROJECT_ENGINES: readonly Engine[] = [
    Engine.CHATGPT,
    Engine.GEMINI,
    Engine.PERPLEXITY,
    Engine.GOOGLE_AI_MODE,
    Engine.COPILOT,
]

export const DEFAULT_PROJECT_ENGINES: readonly Engine[] = [
    Engine.CHATGPT,
    Engine.GEMINI,
    Engine.PERPLEXITY,
]

const selectableSet = new Set<Engine>(SELECTABLE_PROJECT_ENGINES)

export function isSelectableProjectEngine(engine: Engine) {
    return selectableSet.has(engine)
}

// PAYG: all engines are available to every user
export function getEngineLimitForPlan(_plan: Plan) {
    return SELECTABLE_PROJECT_ENGINES.length
}

export function normalizeProjectEngines(input: unknown): Engine[] {
    if (!Array.isArray(input)) return [...DEFAULT_PROJECT_ENGINES]

    const engines = input
        .map(value => String(value).trim().toUpperCase())
        .filter((value): value is Engine => value in Engine)
        .filter(isSelectableProjectEngine)

    return [...new Set(engines)]
}
