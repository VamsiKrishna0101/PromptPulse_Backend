import { Plan } from '@prisma/client'
import { PLAN_LIMITS } from '../subscription/plan_config'

export const PROMPT_LIMIT_BY_PLAN: Record<Plan, number> = {
    [Plan.FREE]: PLAN_LIMITS.FREE.prompts,
    [Plan.STARTER]: PLAN_LIMITS.STARTER.prompts,
    [Plan.GROWTH]: PLAN_LIMITS.GROWTH.prompts,
    [Plan.PRO]: PLAN_LIMITS.PRO.prompts,
}

export function getPromptLimitForPlan(plan: Plan) {
    return PROMPT_LIMIT_BY_PLAN[plan] ?? PROMPT_LIMIT_BY_PLAN.FREE
}
