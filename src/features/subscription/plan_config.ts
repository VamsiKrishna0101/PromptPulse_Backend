import { Plan } from "@prisma/client"
import type { PlanLimits } from "./subscription_types"

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
    FREE: {
        projects: 1,
        prompts: 5,
        competitors: 3,
        refreshes_per_week: 0,
        sara: "full",
        exports: "none",
        credits: 0,
        engine_limit: 3,
    },
    STARTER: {
        projects: 1,
        prompts: 20,
        competitors: 5,
        refreshes_per_week: 2,
        sara: "basic",
        exports: "none",
        credits: 30,
        engine_limit: 3,
    },
    GROWTH: {
        projects: 2,
        prompts: 50,
        competitors: 12,
        refreshes_per_week: "daily",
        sara: "full",
        exports: "basic",
        credits: 100,
        engine_limit: 3,
    },
    PRO: {
        projects: 5,
        prompts: 125,
        competitors: "unlimited",
        refreshes_per_week: "daily",
        sara: "advanced",
        exports: "full",
        credits: 275,
        engine_limit: "all",
    },
}

export const PLAN_PRICING: Record<Plan, { name: string; monthly_price_usd: number | "custom"; trial_days: number | null; summary: string }> = {
    FREE: {
        name: "Free",
        monthly_price_usd: 0,
        trial_days: null,
        summary: "Limited workspace to test PromptPulse before upgrading.",
    },
    STARTER: {
        name: "Starter",
        monthly_price_usd: 29,
        trial_days: 14,
        summary: "Essentials for one brand getting serious about AI visibility.",
    },
    GROWTH: {
        name: "Growth",
        monthly_price_usd: 59,
        trial_days: 14,
        summary: "Best fit for growing SaaS teams that need daily monitoring.",
    },
    PRO: {
        name: "Pro",
        monthly_price_usd: 129,
        trial_days: 14,
        summary: "For agencies and teams managing more markets and competitors.",
    },
}

export const CREDIT_COSTS = {
    dashboard_export_xlsx: 1,
    dashboard_export_pdf: 2,
    geo_article_pdf: 2,
    ai_visibility_report: 5,
    ai_report_ppt: 2,
    content_brief: 3,
    full_article: 5,
    weekly_email_report: 5,
    reddit_intelligence_standard: 1,
    reddit_intelligence_deep: 3,
} as const

export function getPromptLimitForPlan(plan: Plan) {
    return PLAN_LIMITS[plan]?.prompts ?? PLAN_LIMITS.FREE.prompts
}

export function getProjectLimitForPlan(plan: Plan) {
    return PLAN_LIMITS[plan]?.projects ?? PLAN_LIMITS.FREE.projects
}
