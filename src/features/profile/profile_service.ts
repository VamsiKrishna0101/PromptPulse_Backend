import prisma from "../../lib/prisma"
import { getEffectivePlanAccess } from "../subscription/entitlements"

export async function getProfileData(userId: string) {
    const [user, projects, access, planUsage] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                is_verified: true,
                account_type: true,
                role: true,
                plan: true,
                created_at: true,
            },
        }),
        prisma.project.findMany({
            where: { user_id: userId },
            orderBy: { created_at: "desc" },
            select: {
                id: true,
                brand_name: true,
                brand_url: true,
                brand_location: true,
                created_at: true,
                updated_at: true,
            },
        }),
        getEffectivePlanAccess(userId),
        prisma.planUsage.findFirst({
            where: { user_id: userId },
            orderBy: { period_start: "desc" },
            select: {
                prompt_count: true,
                project_count: true,
                competitor_count: true,
                monthly_runs_used: true,
                period_start: true,
                period_end: true,
            },
        }),
    ])

    if (!user) {
        throw new Error("User not found")
    }

    const subscription = access.subscription
        ? await prisma.subscription.findUnique({
            where: { id: access.subscription.id },
            select: {
                id: true,
                plan: true,
                status: true,
                amount_cents: true,
                currency: true,
                current_period_start: true,
                current_period_end: true,
                cancel_at_period_end: true,
                trial_starts_at: true,
                trial_ends_at: true,
                created_at: true,
            },
        })
        : null

    return {
        user: {
            ...user,
            plan: access.plan,
            effective_plan: access.effective_plan,
        },
        projects,
        subscription,
        trial: {
            trial_starts_at: access.trial.starts_at,
            trial_ends_at: access.trial.ends_at,
            trial_active: access.trial.active,
            trial_days_left: access.trial.days_left,
        },
        usage: planUsage ?? {
            prompt_count: 0,
            project_count: 0,
            competitor_count: 0,
            monthly_runs_used: 0,
            period_start: null,
            period_end: null,
        },
    }
}
