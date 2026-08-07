import crypto from "crypto"
import { AccountType, Plan, Prisma, SubscriptionStatus } from "@prisma/client"
import prisma from "../../lib/prisma"
import { resolveBillingUserId } from "./credits_service"
import { getRazorpayClient } from "./razorpay_config"
import {
    getBillingPlan,
    getPlanAmountPaise,
    getRazorpayPlanId,
    type BillingInterval,
    type PaidPlan,
} from "./billing_catalog"

export type RazorpaySubscriptionEntity = {
    id: string
    plan_id: string
    status: string
    current_start?: number | null
    current_end?: number | null
    ended_at?: number | null
    paid_count?: number
    charge_at?: number | null
    notes?: Record<string, string>
}

function assertPaidPlan(plan: unknown): asserts plan is PaidPlan {
    if (plan !== Plan.STARTER && plan !== Plan.GROWTH && plan !== Plan.PRO) {
        throw new Error("Invalid subscription plan")
    }
}

function assertBillingInterval(interval: unknown): asserts interval is BillingInterval {
    if (interval !== "monthly" && interval !== "annual") throw new Error("Invalid billing interval")
}

function fromUnix(value?: number | null) {
    return value ? new Date(value * 1000) : null
}

function addMonths(date: Date, months: number) {
    const next = new Date(date)
    const day = next.getDate()
    next.setDate(1)
    next.setMonth(next.getMonth() + months)
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    next.setDate(Math.min(day, lastDay))
    return next
}

function mapStatus(status: string): SubscriptionStatus {
    if (status === "active" || status === "resumed") return SubscriptionStatus.ACTIVE
    if (status === "pending" || status === "halted" || status === "paused") return SubscriptionStatus.PAST_DUE
    if (status === "cancelled" || status === "completed") return SubscriptionStatus.CANCELED
    return SubscriptionStatus.INCOMPLETE
}

async function grantSubscriptionCredits(subscriptionId: string, grantKey: string, scheduledFor: Date) {
    const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } })
    if (!subscription || subscription.status === SubscriptionStatus.CANCELED) return { granted: false, credits: 0 }
    const plan = subscription.plan as PaidPlan
    assertPaidPlan(plan)
    const credits = getBillingPlan(plan).monthly_credits
    const expiresAt = plan === Plan.STARTER ? addMonths(scheduledFor, 1) : null

    try {
        await prisma.$transaction(async tx => {
            await tx.subscriptionCreditGrant.create({
                data: { subscription_id: subscription.id, grant_key: grantKey, credits, scheduled_for: scheduledFor },
            })
            await tx.user.update({
                where: { id: subscription.user_id },
                data: { credits_balance: { increment: credits }, plan },
            })
            await tx.creditTransaction.create({
                data: {
                    user_id: subscription.user_id,
                    idempotency_key: grantKey,
                    amount: credits,
                    action: "PLAN_CREDITS",
                    description: `${getBillingPlan(plan).name} included credits`,
                    metadata: {
                        idempotency_key: grantKey,
                        subscription_id: subscription.id,
                        billing_interval: subscription.billing_interval,
                        scheduled_for: scheduledFor.toISOString(),
                    },
                },
            })
            await tx.creditBucket.create({
                data: {
                    user_id: subscription.user_id,
                    amount_remaining: credits,
                    source: `${plan}_INCLUDED`,
                    expires_at: expiresAt,
                },
            })
        })
        return { granted: true, credits }
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return { granted: false, credits: 0 }
        }
        throw error
    }
}

export async function createRazorpaySubscription(input: {
    userId: string
    plan: PaidPlan
    billingInterval: BillingInterval
}) {
    assertPaidPlan(input.plan)
    assertBillingInterval(input.billingInterval)
    const userId = await resolveBillingUserId(input.userId)
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, account_type: true } })
    if (!user) throw new Error("User not found")
    if (user.account_type === AccountType.AGENCY) throw new Error("Agency accounts use shared-wallet credit packs instead of subscriptions")

    const active = await prisma.subscription.findFirst({
        where: {
            user_id: userId,
            razorpay_subscription_id: { not: null },
            status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE, SubscriptionStatus.INCOMPLETE] },
        },
    })

    if (active) {
        // For INCOMPLETE subscriptions (abandoned checkouts), verify with Razorpay before blocking.
        // If Razorpay considers it cancelled/expired/created-but-never-authenticated, auto-clean it.
        if (active.status === SubscriptionStatus.INCOMPLETE && active.razorpay_subscription_id) {
            try {
                const remote = await (getRazorpayClient().subscriptions as any).fetch(active.razorpay_subscription_id) as RazorpaySubscriptionEntity
                const terminalStatuses = ["cancelled", "completed", "expired"]
                // "created" means they opened checkout but never authenticated UPI/card — safe to drop
                const abandonedStatuses = ["created"]
                if (terminalStatuses.includes(remote.status) || abandonedStatuses.includes(remote.status)) {
                    // Stale record — mark it cancelled locally so we can create a fresh one
                    await prisma.subscription.update({
                        where: { id: active.id },
                        data: { status: SubscriptionStatus.CANCELED },
                    })
                    // Fall through to create a new subscription below
                } else {
                    throw new Error("An auto-renewing subscription already exists")
                }
            } catch (err) {
                if (err instanceof Error && err.message === "An auto-renewing subscription already exists") throw err
                // If Razorpay fetch fails, be conservative and block
                throw new Error("An auto-renewing subscription already exists")
            }
        } else {
            throw new Error("An auto-renewing subscription already exists")
        }
    }

    const razorpayPlanId = getRazorpayPlanId(input.plan, input.billingInterval)
    const razorpay = getRazorpayClient()
    const remote = await (razorpay.subscriptions as any).create({
        plan_id: razorpayPlanId,
        total_count: input.billingInterval === "annual" ? 12 : 60,
        quantity: 1,
        customer_notify: 1,
        notes: {
            user_id: userId,
            plan: input.plan,
            billing_interval: input.billingInterval,
            account_type: user.account_type,
        },
    })

    await prisma.subscription.create({
        data: {
            user_id: userId,
            plan: input.plan,
            status: SubscriptionStatus.INCOMPLETE,
            amount_cents: getPlanAmountPaise(input.plan, input.billingInterval),
            currency: "inr",
            billing_interval: input.billingInterval,
            razorpay_subscription_id: remote.id,
            razorpay_plan_id: razorpayPlanId,
            trial_ends_at: null,
        },
    })

    return {
        razorpay_subscription_id: remote.id as string,
        key_id: process.env.RAZORPAY_KEY_ID ?? "",
        plan: input.plan,
        billing_interval: input.billingInterval,
        amount_inr_paise: getPlanAmountPaise(input.plan, input.billingInterval),
        monthly_credits: getBillingPlan(input.plan).monthly_credits,
        account_type: user.account_type,
    }
}

export async function verifyRazorpaySubscription(input: {
    userId: string
    razorpayPaymentId: string
    razorpaySubscriptionId: string
    razorpaySignature: string
}) {
    const userId = await resolveBillingUserId(input.userId)
    const secret = process.env.RAZORPAY_KEY_SECRET
    if (!secret) throw new Error("RAZORPAY_KEY_SECRET is not configured")
    const expected = crypto.createHmac("sha256", secret)
        .update(`${input.razorpayPaymentId}|${input.razorpaySubscriptionId}`)
        .digest("hex")
    const expectedBuffer = Buffer.from(expected)
    const receivedBuffer = Buffer.from(input.razorpaySignature)
    if (expectedBuffer.length !== receivedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
        throw new Error("Invalid Razorpay subscription signature")
    }
    const subscription = await prisma.subscription.findFirst({
        where: { user_id: userId, razorpay_subscription_id: input.razorpaySubscriptionId },
    })
    if (!subscription) throw new Error("Subscription not found")

    // The browser signature proves the checkout response was signed by Razorpay,
    // but it does not update our database. Fetch the authoritative subscription
    // before applying the same idempotent charge path used by webhooks.
    const remote = await (getRazorpayClient().subscriptions as any).fetch(input.razorpaySubscriptionId) as RazorpaySubscriptionEntity
    if (!remote || remote.id !== input.razorpaySubscriptionId) {
        throw new Error("Razorpay subscription could not be confirmed")
    }
    if (subscription.razorpay_plan_id && remote.plan_id !== subscription.razorpay_plan_id) {
        throw new Error("Razorpay subscription plan mismatch")
    }

    const synced = await processRazorpaySubscriptionWebhook({
        eventType: "subscription.charged",
        subscription: remote,
        paymentId: input.razorpayPaymentId,
    })
    const current = await prisma.subscription.findUnique({ where: { id: subscription.id } })
    return {
        verified: true,
        status: current?.status ?? subscription.status,
        plan: current?.plan ?? subscription.plan,
        credits_granted: synced.grant?.credits ?? 0,
    }
}

export async function processRazorpaySubscriptionWebhook(input: {
    eventType: string
    createdAt?: number
    subscription: RazorpaySubscriptionEntity
    paymentId?: string | null
}) {
    const webhookKey = [
        input.eventType,
        input.subscription.id,
        input.paymentId ?? "none",
        input.subscription.paid_count ?? 0,
        input.createdAt ?? 0,
    ].join(":")

    try {
        await prisma.razorpayWebhookEvent.create({ data: { webhook_key: webhookKey, event_type: input.eventType } })
    } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error

        const prior = await prisma.razorpayWebhookEvent.findUnique({ where: { webhook_key: webhookKey } })
        if (prior?.status === "PROCESSED") return { status: "already_processed" as const }
        if (prior?.status === "PROCESSING") return { status: "already_processing" as const }

        // A failed delivery must be retryable. Razorpay retries webhooks, so
        // reclaim the event only after a previous attempt was marked FAILED.
        await prisma.razorpayWebhookEvent.update({
            where: { webhook_key: webhookKey },
            data: { status: "PROCESSING", error_reason: null, processed_at: null },
        })
    }

    try {
        const existing = await prisma.subscription.findUnique({
            where: { razorpay_subscription_id: input.subscription.id },
        })
        if (!existing) throw new Error("Unknown Razorpay subscription")

        const status = mapStatus(input.subscription.status)
        const currentStart = fromUnix(input.subscription.current_start)
        const currentEnd = fromUnix(input.subscription.current_end)
        await prisma.subscription.update({
            where: { id: existing.id },
            data: {
                status,
                razorpay_paid_count: input.subscription.paid_count ?? existing.razorpay_paid_count,
                current_period_start: currentStart ?? undefined,
                current_period_end: currentEnd ?? undefined,
                cancel_at_period_end: input.eventType === "subscription.completed" || input.eventType === "subscription.cancelled",
                ...(status === SubscriptionStatus.CANCELED ? { next_credit_grant_at: null } : {}),
            },
        })

        if (status === SubscriptionStatus.CANCELED) {
            await prisma.user.update({ where: { id: existing.user_id }, data: { plan: Plan.FREE } })
        }

        let grant = { granted: false, credits: 0 }
        if (input.eventType === "subscription.charged" && input.paymentId) {
            const scheduledFor = currentStart ?? new Date()
            grant = await grantSubscriptionCredits(existing.id, `razorpay-charge:${input.paymentId}`, scheduledFor)
        }

        await prisma.razorpayWebhookEvent.update({
            where: { webhook_key: webhookKey },
            data: { status: "PROCESSED", processed_at: new Date() },
        })
        return { status: "processed" as const, grant }
    } catch (error) {
        await prisma.razorpayWebhookEvent.update({
            where: { webhook_key: webhookKey },
            data: { status: "FAILED", error_reason: error instanceof Error ? error.message : "Unknown error" },
        })
        throw error
    }
}

export async function grantDueAnnualSubscriptionCreditsForUser(actorUserId: string) {
    const userId = await resolveBillingUserId(actorUserId)
    const now = new Date()
    const due = await prisma.subscription.findMany({
        where: {
            user_id: userId,
            billing_interval: "annual",
            status: SubscriptionStatus.ACTIVE,
            next_credit_grant_at: { lte: now },
            current_period_end: { gt: now },
        },
    })

    for (const subscription of due) {
        let scheduledFor = subscription.next_credit_grant_at!
        while (scheduledFor <= now && (!subscription.current_period_end || scheduledFor < subscription.current_period_end)) {
            const key = `annual-tranche:${subscription.id}:${scheduledFor.toISOString().slice(0, 10)}`
            await grantSubscriptionCredits(subscription.id, key, scheduledFor)
            scheduledFor = addMonths(scheduledFor, 1)
        }
        await prisma.subscription.update({ where: { id: subscription.id }, data: { next_credit_grant_at: scheduledFor } })
    }
}

export async function getBillingAudience(userId: string) {
    const billingUserId = await resolveBillingUserId(userId)
    const user = await prisma.user.findUnique({ where: { id: billingUserId }, select: { account_type: true } })
    return user?.account_type ?? AccountType.SINGLE
}
