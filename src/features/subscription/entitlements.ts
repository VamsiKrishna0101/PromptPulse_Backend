import { Plan, SubscriptionStatus } from "@prisma/client"
import prisma from "../../lib/prisma"
import { PLAN_LIMITS } from "./plan_config"
import type { PlanLimits } from "./subscription_types"

export const FREE_TRIAL_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000

export type EffectivePlanAccess = {
    plan: Plan
    effective_plan: Plan
    status: string
    subscription: {
        id: string
        plan: Plan
        status: SubscriptionStatus
        current_period_start: Date | null
        current_period_end: Date | null
        cancel_at_period_end: boolean
        trial_starts_at: Date | null
        trial_ends_at: Date | null
    } | null
    limits: PlanLimits
    trial: {
        active: boolean
        expired: boolean
        starts_at: Date | null
        ends_at: Date | null
        days_left: number
    }
}

export function addFreeTrialDays(date: Date) {
    return new Date(date.getTime() + FREE_TRIAL_DAYS * MS_PER_DAY)
}

export async function ensureFreeTrialSubscription(userId: string) {
    const existing = await prisma.subscription.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        select: { id: true },
    })

    if (existing) return existing

    const startsAt = new Date()
    const endsAt = addFreeTrialDays(startsAt)
    return prisma.subscription.create({
        data: {
            user_id: userId,
            plan: Plan.GROWTH,
            status: SubscriptionStatus.TRIALING,
            amount_cents: 0,
            trial_starts_at: startsAt,
            trial_ends_at: endsAt,
            current_period_start: startsAt,
            current_period_end: endsAt,
        },
        select: { id: true },
    })
}

export async function getEffectivePlanAccess(userId: string): Promise<EffectivePlanAccess> {
    const subscriptions = await prisma.subscription.findMany({
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
        take: 10,
        select: {
            id: true,
            plan: true,
            status: true,
            amount_cents: true,
            stripe_subscription_id: true,
            current_period_start: true,
            current_period_end: true,
            cancel_at_period_end: true,
            trial_starts_at: true,
            trial_ends_at: true,
        },
    })

    if (subscriptions.length === 0) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { is_verified: true, plan: true },
        })

        if (user?.is_verified && user.plan === Plan.FREE) {
            await ensureFreeTrialSubscription(userId)
            return getEffectivePlanAccess(userId)
        }
    }

    const now = new Date()
    const activePaidSubscription = subscriptions.find(subscription =>
        subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.PAST_DUE
    )
    const activeTrialSubscription = subscriptions.find(subscription =>
        subscription.status === SubscriptionStatus.TRIALING
        && (subscription.trial_ends_at ?? addFreeTrialDays(subscription.trial_starts_at)).getTime() > now.getTime()
    )
    const latestExpiredTrial = subscriptions.find(subscription =>
        subscription.status === SubscriptionStatus.TRIALING
        && (subscription.trial_ends_at ?? addFreeTrialDays(subscription.trial_starts_at)).getTime() <= now.getTime()
    )
    const subscription = activePaidSubscription ?? activeTrialSubscription ?? subscriptions[0] ?? null
    const trialStartsAt = subscription?.trial_starts_at ?? null
    const trialEndsAt = subscription?.trial_ends_at ?? (trialStartsAt ? addFreeTrialDays(trialStartsAt) : null)
    const isTrialStatus = subscription?.status === SubscriptionStatus.TRIALING
    const trialActive = Boolean(isTrialStatus && trialEndsAt && trialEndsAt.getTime() > now.getTime())
    const trialExpired = Boolean(
        !activePaidSubscription
        && !activeTrialSubscription
        && latestExpiredTrial
    )
    const paidAccess = Boolean(subscription && (
        subscription.status === SubscriptionStatus.ACTIVE || subscription.status === SubscriptionStatus.PAST_DUE
    ))
    const isFreeProductTrial = Boolean(trialActive && !subscription?.stripe_subscription_id && subscription?.amount_cents === 0)
    const effectivePlan = trialActive ? Plan.GROWTH : paidAccess ? subscription!.plan : Plan.FREE
    const limits = isFreeProductTrial
        ? { ...PLAN_LIMITS.GROWTH, prompts: PLAN_LIMITS.FREE.prompts }
        : PLAN_LIMITS[effectivePlan]

    return {
        plan: isFreeProductTrial ? Plan.FREE : effectivePlan,
        effective_plan: effectivePlan,
        status: isFreeProductTrial ? "FREE_TRIAL" : trialExpired ? "TRIAL_EXPIRED" : subscription?.status ?? "FREE",
        subscription: subscription
            ? {
                id: subscription.id,
                plan: subscription.plan,
                status: subscription.status,
                current_period_start: subscription.current_period_start,
                current_period_end: subscription.current_period_end,
                cancel_at_period_end: subscription.cancel_at_period_end,
                trial_starts_at: subscription.trial_starts_at,
                trial_ends_at: subscription.trial_ends_at,
            }
            : null,
        limits,
        trial: {
            active: isFreeProductTrial,
            expired: trialExpired,
            starts_at: latestExpiredTrial?.trial_starts_at ?? trialStartsAt,
            ends_at: latestExpiredTrial?.trial_ends_at ?? trialEndsAt,
            days_left: isFreeProductTrial && trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / MS_PER_DAY)) : 0,
        },
    }
}

export async function getAccessPeriod(userId: string): Promise<{ start: Date; end: Date }> {
    const access = await getEffectivePlanAccess(userId)
    const now = new Date()
    return {
        start: access.subscription?.current_period_start ?? access.trial.starts_at ?? new Date(now.getFullYear(), now.getMonth(), 1),
        end: access.subscription?.current_period_end ?? access.trial.ends_at ?? new Date(now.getFullYear(), now.getMonth() + 1, 1),
    }
}
