import { Plan } from "@prisma/client"
import prisma from "../../../lib/prisma"
import { getCreditBalance } from "../../credits/credits_service"
import { getEffectivePlanAccess } from "../../subscription/entitlements"
import { formatDate, formatLimit, type SaraContextSection } from "./context_format"

export type SaraPlanContext = {
    plan: Plan
    sara_level: "basic" | "full" | "advanced"
    guidance: string
    section: SaraContextSection
}

const PLAN_GUIDANCE: Record<Plan, string> = {
    FREE: "Growth-style preview: answer with strategic depth, but be concise and show the user what stronger monitoring unlocks.",
    STARTER: "Core assistant: explain metrics, diagnose obvious gaps, and give simple next steps. Avoid multi-project or agency-level planning.",
    GROWTH: "Strategist assistant: connect dashboard metrics, sources, prompts, competitors, and action queue into prioritized recommendations.",
    PRO: "Operator assistant: provide advanced strategy, portfolio-style reasoning, executive framing, and deeper source/competitor playbooks.",
}

export async function buildSaraPlanContext(user_id: string): Promise<SaraPlanContext> {
    const [access, usage, creditBalance] = await Promise.all([
        getEffectivePlanAccess(user_id),
        prisma.planUsage.findFirst({
            where: { user_id },
            orderBy: { period_start: "desc" },
        }),
        getCreditBalance(user_id),
    ])

    const limits = access.limits
    const saraLevel = limits.sara === "advanced"
        ? "advanced"
        : limits.sara === "full"
            ? "full"
            : "basic"

    return {
        plan: access.plan,
        sara_level: saraLevel,
        guidance: PLAN_GUIDANCE[access.effective_plan],
        section: {
            title: "Subscription and Sara Access",
            lines: [
                `Plan: ${access.plan}`,
                `Effective access: ${access.effective_plan}`,
                `Sara mode: ${saraLevel}`,
                `Sara behavior: ${PLAN_GUIDANCE[access.effective_plan]}`,
                `Limits: ${limits.projects} project(s), ${limits.prompts} prompt(s), ${formatLimit(limits.competitors)} competitor(s), refresh ${limits.refreshes_per_week}`,
                `Usage: ${usage?.project_count ?? 0} project(s), ${usage?.prompt_count ?? 0} prompt(s), ${usage?.competitor_count ?? 0} competitor(s), ${usage?.monthly_runs_used ?? 0} monthly runs`,
                `Credits: ${creditBalance.remaining}/${creditBalance.monthly_credits} remaining this period`,
                access.subscription ? `Subscription status: ${access.subscription.status} on ${access.subscription.plan}` : "Subscription status: free workspace",
                access.trial.ends_at ? `Trial ends: ${formatDate(access.trial.ends_at)}` : null,
                access.subscription?.current_period_end ? `Current period ends: ${formatDate(access.subscription.current_period_end)}` : null,
            ],
        },
    }
}
