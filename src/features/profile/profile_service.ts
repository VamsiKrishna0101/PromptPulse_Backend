import { SubscriptionStatus } from "@prisma/client"
import prisma from "../../lib/prisma"

const TRIAL_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

function addDays(date: Date, days: number) {
    return new Date(date.getTime() + days * MS_PER_DAY)
}

function getTrialMeta(subscription: { trial_starts_at: Date | null; trial_ends_at: Date | null } | null) {
    if (!subscription?.trial_starts_at) {
        return {
            trial_starts_at: null,
            trial_ends_at: null,
            trial_active: false,
            trial_days_left: 0,
        }
    }

    const trialEndsAt = subscription.trial_ends_at ?? addDays(subscription.trial_starts_at, TRIAL_DAYS)
    const daysLeft = Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / MS_PER_DAY))

    return {
        trial_starts_at: subscription.trial_starts_at,
        trial_ends_at: trialEndsAt,
        trial_active: trialEndsAt.getTime() > Date.now(),
        trial_days_left: daysLeft,
    }
}

export async function getProfileData(userId: string) {
    const [user, projects, subscription, planUsage] = await Promise.all([
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
        prisma.subscription.findFirst({
            where: {
                user_id: userId,
                status: {
                    in: [
                        SubscriptionStatus.ACTIVE,
                        SubscriptionStatus.TRIALING,
                        SubscriptionStatus.PAST_DUE,
                        SubscriptionStatus.INCOMPLETE,
                    ],
                },
            },
            orderBy: { created_at: "desc" },
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
        }),
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

    return {
        user,
        projects,
        subscription,
        trial: getTrialMeta(subscription),
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
