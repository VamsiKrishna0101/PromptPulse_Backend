import type { Plan } from "@prisma/client"

export type PaidPlan = Exclude<Plan, "FREE">

export type PlanLimits = {
    projects: number
    prompts: number
    competitors: number
    refreshes_per_week: number | "daily"
    sara: "none" | "basic" | "full" | "advanced"
    exports: "none" | "basic" | "full"
}

export type CreateSubscriptionInput = {
    user_id: string
    plan: PaidPlan
}

export type CreateSubscriptionResponse = {
    checkout_session_id: string
    checkout_url: string
    plan: PaidPlan
}

export type MyPlanResponse = {
    plan: Plan
    status: string
    subscription: {
        id: string
        plan: Plan
        status: string
        current_period_start: Date | null
        current_period_end: Date | null
        cancel_at_period_end: boolean
        trial_starts_at: Date | null
        trial_ends_at: Date | null
    } | null
    limits: PlanLimits
    usage: {
        prompt_count: number
        project_count: number
        competitor_count: number
        monthly_runs_used: number
        period_start: Date | null
        period_end: Date | null
    }
}

export type SubscriptionLimitFeature =
    | "project"
    | "prompt"
    | "competitor"
    | "refresh"
    | "sara"
    | "export"

export type LimitCheckResponse = {
    feature: SubscriptionLimitFeature
    allowed: boolean
    plan: Plan
    limit: number | string
    used: number
    reason?: string
}
