import { Plan } from "@prisma/client"
import type { PlanLimits } from "./subscription_types"

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
    FREE: {
        projects: 1,
        prompts: 5,
        competitors: 3,
        refreshes_per_week: 0,
        sara: "full",
        sara_daily_limit: 10,
        exports: "none",
        credits: 0,
        engine_limit: 3,
    },
    STARTER: {
        projects: 1,
        prompts: 15,
        competitors: 3,
        refreshes_per_week: "daily",
        sara: "full",
        sara_daily_limit: "unlimited",
        exports: "full",
        credits: 2250,
        engine_limit: "all",
    },
    GROWTH: {
        projects: 2,
        prompts: 30,
        competitors: 6,
        refreshes_per_week: "daily",
        sara: "full",
        sara_daily_limit: "unlimited",
        exports: "full",
        credits: 5000,
        engine_limit: "all",
    },
    PRO: {
        projects: 5,
        prompts: 75,
        competitors: 15,
        refreshes_per_week: "daily",
        sara: "advanced",
        sara_daily_limit: "unlimited",
        exports: "full",
        credits: 13000,
        engine_limit: "all",
    },
    // Agency is a dedicated Pay-As-You-Go plan.
    // No base credits — agencies buy credits as they consume them across client projects.
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
    prompt_run: 1,
    dashboard_export_xlsx: 1,
    dashboard_export_pdf: 0,
    geo_article_pdf: 0,
    ai_visibility_report: 25,
    ai_report_ppt: 0,
    content_brief: 15,
    full_article: 30,
    weekly_email_report: 25,
    reddit_intelligence_standard: 25,
    reddit_intelligence_deep: 50,
    seo_audit: 15,
} as const

export function getPromptLimitForPlan(plan: Plan) {
    return PLAN_LIMITS[plan]?.prompts ?? PLAN_LIMITS.FREE.prompts
}

export function getProjectLimitForPlan(plan: Plan) {
    return PLAN_LIMITS[plan]?.projects ?? PLAN_LIMITS.FREE.projects
}
