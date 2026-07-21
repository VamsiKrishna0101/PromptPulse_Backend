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

export function getEngineLimitForPlan(plan: Plan) {
    const limit = PLAN_LIMITS[plan]?.engine_limit ?? 3
    return limit === "all" ? SELECTABLE_PROJECT_ENGINES.length : limit
}

export function normalizeProjectEngines(input: unknown): Engine[] {
    if (!Array.isArray(input)) return [...DEFAULT_PROJECT_ENGINES]

    const engines = input
        .map(value => String(value).trim().toUpperCase())
        .filter((value): value is Engine => value in Engine)
        .filter(isSelectableProjectEngine)

    return [...new Set(engines)]
}
