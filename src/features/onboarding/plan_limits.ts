import { Plan } from '@prisma/client'

export const PROMPT_LIMIT_BY_PLAN: Record<Plan, number> = {
    [Plan.FREE]: 5,
    [Plan.STARTER]: 25,
    [Plan.GROWTH]: 50,
    [Plan.PRO]: 150,
}

export function getPromptLimitForPlan(plan: Plan) {
    return PROMPT_LIMIT_BY_PLAN[plan] ?? PROMPT_LIMIT_BY_PLAN.FREE
}
