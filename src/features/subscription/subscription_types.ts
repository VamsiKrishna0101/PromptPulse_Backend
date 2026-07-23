import type { Plan } from "@prisma/client"

export type PaidPlan = Exclude<Plan, "FREE">
export type BillingInterval = "monthly" | "annual"

export type PlanLimits = {
    projects: number | "unlimited"
    prompts: number | "unlimited"
    competitors: number | "unlimited"
    refreshes_per_week: number | "daily"
    sara: "none" | "basic" | "full" | "advanced"
    sara_daily_limit: number | "unlimited"
    exports: "none" | "basic" | "full"
    credits: number
    engine_limit: number | "all"
}

export type CreateSubscriptionInput = {
    user_id: string
    plan: PaidPlan
    billing_interval: BillingInterval
    request_id?: string
}

export type CreateSubscriptionResponse = {
    checkout_session_id: string
    checkout_url: string
    plan: PaidPlan
    billing_interval: BillingInterval
}

export type MyPlanResponse = {
    plan: Plan
    effective_plan: Plan
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
    trial: {
        active: boolean
        expired: boolean
        starts_at: Date | null
        ends_at: Date | null
        days_left: number
    }
    limits: PlanLimits
    usage: {
        prompt_count: number
        project_count: number
        competitor_count: number
        monthly_runs_used: number
        credits_used: number
        credits_remaining: number
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
    | "credit"

export type LimitCheckResponse = {
    feature: SubscriptionLimitFeature
    allowed: boolean
    plan: Plan
    limit: number | string
    used: number
    reason?: string
}

export type PlanQuotaResponse = {
    plan: Plan
    limits: PlanLimits
    usage: {
        project_count: number
        prompt_count: number
        competitor_count: number
    }
    remaining: {
        projects: number | "unlimited"
        prompts: number | "unlimited"
        competitors: number | "unlimited"
    }
}
