import type Stripe from "stripe"
import { Plan, SubscriptionStatus } from "@prisma/client"
import prisma from "../../lib/prisma"
import type {
    CreateSubscriptionInput,
    CreateSubscriptionResponse,
    LimitCheckResponse,
    MyPlanResponse,
    PlanQuotaResponse,
    PaidPlan,
    PlanLimits,
    SubscriptionLimitFeature,
    BillingInterval,
} from "./subscription_types"
import { getAccessPeriod, getEffectivePlanAccess } from "./entitlements"
import { getCreditBalance } from "../credits/credits_service"
import { getRefreshWindowStart } from "../refresh/refresh_window"
import { getStripeClient, getStripeId, getStripePrice } from "./stripe_config"

const ACCESS_STATUSES: SubscriptionStatus[] = [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.PAST_DUE,
]

function assertPaidPlan(plan: unknown): asserts plan is PaidPlan {
    if (plan !== Plan.STARTER && plan !== Plan.GROWTH && plan !== Plan.PRO) {
        throw new Error("Invalid subscription plan")
    }
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
    if (status === "trialing") return SubscriptionStatus.TRIALING
    if (status === "active") return SubscriptionStatus.ACTIVE
    if (status === "past_due" || status === "unpaid") return SubscriptionStatus.PAST_DUE
    if (status === "canceled") return SubscriptionStatus.CANCELED
    return SubscriptionStatus.INCOMPLETE
}

function unixToDate(value?: number | null): Date | null {
    return value ? new Date(value * 1000) : null
}

function toPaidPlan(plan: string | null | undefined): PaidPlan {
    assertPaidPlan(plan)
    return plan
}

function buildCheck(
    feature: SubscriptionLimitFeature,
    plan: Plan,
    limit: number | string,
    used: number,
    allowed: boolean,
    reason?: string,
): LimitCheckResponse {
    return { feature, plan, limit, used, allowed, reason }
}

function remaining(limit: number | "unlimited", used: number) {
    if (limit === "unlimited") return "unlimited"
    return Math.max(0, limit - used)
}

function remainingNumber(limit: number, used: number) {
    return Math.max(0, limit - used)
}

function isWithinLimit(limit: number | "unlimited", used: number) {
    return limit === "unlimited" || used < limit
}

function formatLimit(limit: number | "unlimited") {
    return limit === "unlimited" ? "unlimited" : String(limit)
}

async function getLiveUsageCounts(userId: string) {
    const [projectCount, promptCount, competitorCount] = await Promise.all([
        prisma.project.count({ where: { user_id: userId } }),
        prisma.prompt.count({
            where: {
                project: { user_id: userId },
                is_active: true,
                status: "ACTIVE",
            },
        }),
        prisma.competitor.count({ where: { project: { user_id: userId } } }),
    ])

    return {
        project_count: projectCount,
        prompt_count: promptCount,
        competitor_count: competitorCount,
    }
}

async function getCurrentPeriod(userId: string): Promise<{ start: Date; end: Date }> {
    return getAccessPeriod(userId)
}

export async function createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResponse> {
    assertPaidPlan(input.plan)
    if (input.billing_interval !== "monthly" && input.billing_interval !== "annual") throw new Error("Invalid billing interval")
    const stripe = getStripeClient()
    const stripePrice = getStripePrice(input.plan, input.billing_interval)

    const user = await prisma.user.findUnique({
        where: { id: input.user_id },
        select: { id: true, email: true },
    })

    if (!user) {
        throw new Error("User not found")
    }

    const activeSubscription = await prisma.subscription.findFirst({
        where: {
            user_id: user.id,
            stripe_subscription_id: { not: null },
            status: {
                in: ACCESS_STATUSES,
            },
        },
        orderBy: { created_at: "desc" },
    })

    if (activeSubscription) {
        throw new Error("User already has an active subscription")
    }

    const existingSubscription = await prisma.subscription.findFirst({
        where: {
            user_id: user.id,
            stripe_customer_id: { not: null },
        },
        orderBy: { created_at: "desc" },
        select: { stripe_customer_id: true },
    })

    const customerId = existingSubscription?.stripe_customer_id ?? (
        await stripe.customers.create({
            email: user.email,
            metadata: {
                user_id: user.id,
            },
        })
    ).id

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173"
    const automaticTax = process.env.STRIPE_AUTOMATIC_TAX_ENABLED === "true"
    const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.id,
        line_items: [
            {
                price: stripePrice.price_id,
                quantity: 1,
            },
        ],
        success_url: process.env.STRIPE_CHECKOUT_SUCCESS_URL ?? `${frontendUrl}/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: process.env.STRIPE_CHECKOUT_CANCEL_URL ?? `${frontendUrl}/subscription?checkout=cancelled`,
        billing_address_collection: "required",
        customer_update: { address: "auto", name: "auto" },
        tax_id_collection: { enabled: true },
        automatic_tax: { enabled: automaticTax },
        metadata: {
            user_id: user.id,
            plan: input.plan,
            billing_interval: input.billing_interval,
        },
        subscription_data: {
            metadata: {
                user_id: user.id,
                plan: input.plan,
                billing_interval: input.billing_interval,
            },
        },
        allow_promotion_codes: true,
    }, input.request_id ? { idempotencyKey: `checkout:${user.id}:${input.request_id}` } : undefined)

    await prisma.subscription.create({
        data: {
            user_id: user.id,
            plan: input.plan,
            status: SubscriptionStatus.INCOMPLETE,
            amount_cents: stripePrice.amount_cents,
            stripe_customer_id: customerId,
            stripe_checkout_session_id: session.id,
            billing_interval: input.billing_interval,
        },
    })

    if (!session.url) {
        throw new Error("Stripe checkout session URL was not created")
    }

    return {
        checkout_session_id: session.id,
        checkout_url: session.url,
        plan: input.plan,
        billing_interval: input.billing_interval,
    }
}

export async function syncSubscriptionFromStripe(stripeSubscription: Stripe.Subscription) {
    const subscriptionWithPeriod = stripeSubscription as Stripe.Subscription & {
        current_period_start?: number | null
        current_period_end?: number | null
        trial_start?: number | null
    }
    const stripeSubscriptionId = stripeSubscription.id
    const stripeCustomerId = getStripeId(stripeSubscription.customer)
    const status = mapStripeStatus(stripeSubscription.status)
    const plan = toPaidPlan(stripeSubscription.metadata?.plan)
    const billingInterval: BillingInterval = stripeSubscription.metadata?.billing_interval === "annual" ? "annual" : "monthly"
    const stripePrice = getStripePrice(plan, billingInterval)
    const metadataUserId = stripeSubscription.metadata?.user_id

    const existingSubscription = await prisma.subscription.findFirst({
        where: {
            OR: [
                { stripe_subscription_id: stripeSubscriptionId },
                ...(stripeCustomerId ? [{ stripe_customer_id: stripeCustomerId }] : []),
            ],
        },
        orderBy: { created_at: "desc" },
        select: { id: true, user_id: true },
    })

    const userId = metadataUserId ?? existingSubscription?.user_id
    if (!userId) {
        throw new Error("Stripe subscription is missing user_id metadata")
    }

    const subscription = existingSubscription
        ? await prisma.subscription.update({
            where: { id: existingSubscription.id },
            data: {
                plan,
                status,
                amount_cents: stripePrice.amount_cents,
                billing_interval: billingInterval,
                stripe_customer_id: stripeCustomerId,
                stripe_subscription_id: stripeSubscriptionId,
                current_period_start: unixToDate(subscriptionWithPeriod.current_period_start),
                current_period_end: unixToDate(subscriptionWithPeriod.current_period_end),
                cancel_at_period_end: stripeSubscription.cancel_at_period_end ?? false,
                trial_starts_at: unixToDate(subscriptionWithPeriod.trial_start) ?? undefined,
                trial_ends_at: unixToDate(stripeSubscription.trial_end),
            },
        })
        : await prisma.subscription.create({
            data: {
                user_id: userId,
                plan,
                status,
                amount_cents: stripePrice.amount_cents,
                billing_interval: billingInterval,
                stripe_customer_id: stripeCustomerId,
                stripe_subscription_id: stripeSubscriptionId,
                current_period_start: unixToDate(subscriptionWithPeriod.current_period_start),
                current_period_end: unixToDate(subscriptionWithPeriod.current_period_end),
                cancel_at_period_end: stripeSubscription.cancel_at_period_end ?? false,
                trial_starts_at: unixToDate(subscriptionWithPeriod.trial_start) ?? new Date(),
                trial_ends_at: unixToDate(stripeSubscription.trial_end),
            },
        })

    await prisma.user.update({
        where: { id: userId },
        data: {
            plan: ACCESS_STATUSES.includes(status)
                ? plan
                : Plan.FREE,
        },
    })

    return subscription
}

export async function createBillingPortalSession(userId: string) {
    const subscription = await prisma.subscription.findFirst({ where: { user_id: userId, stripe_customer_id: { not: null } }, orderBy: { created_at: "desc" } })
    if (!subscription?.stripe_customer_id) throw new Error("No Stripe billing account found")
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173"
    const session = await getStripeClient().billingPortal.sessions.create({ customer: subscription.stripe_customer_id, return_url: `${frontendUrl}/subscription` })
    return { url: session.url }
}

export async function verifyCheckoutSession(userId: string, sessionId: string) {
    const session = await getStripeClient().checkout.sessions.retrieve(sessionId)
    if (session.client_reference_id !== userId && session.metadata?.user_id !== userId) throw new Error("Checkout session not found")
    const subscriptionId = getStripeId(session.subscription)
    if (subscriptionId) await syncSubscriptionFromStripe(await getStripeClient().subscriptions.retrieve(subscriptionId))
    return {
        status: session.status,
        payment_status: session.payment_status,
        plan: session.metadata?.plan ?? null,
        billing_interval: session.metadata?.billing_interval ?? null,
    }
}

export async function getUserPlan(userId: string): Promise<Plan> {
    return (await getEffectivePlanAccess(userId)).effective_plan
}

export async function getPlanLimits(userId: string): Promise<PlanLimits> {
    return (await getEffectivePlanAccess(userId)).limits
}

export async function getPlanQuota(userId: string): Promise<PlanQuotaResponse> {
    const access = await getEffectivePlanAccess(userId)
    const plan = access.plan
    const limits = access.limits
    const usage = await getLiveUsageCounts(userId)

    return {
        plan,
        limits,
        usage,
        remaining: {
            projects: remaining(limits.projects, usage.project_count),
            prompts: remaining(limits.prompts, usage.prompt_count),
            competitors: remaining(limits.competitors, usage.competitor_count),
        },
    }
}

// PAYG: no project or prompt limits — always allow
export async function assertCanCreateProjectWithPrompts(userId: string, promptCount: number) {
    const access = await getEffectivePlanAccess(userId)
    const credits = await getCreditBalance(userId)
    if (access.trial.expired && access.effective_plan === Plan.FREE && credits.remaining <= 0) {
        throw new Error("Your free trial has ended. Please upgrade or add credits to create new brand workspaces.")
    }
    if (access.trial.active) {
        const projectCount = await prisma.project.count({ where: { user_id: userId } })
        if (projectCount >= 1) {
            throw new Error("Your Free Trial includes 1 Brand Workspace. Upgrade or add credits to manage multiple brands.")
        }
        const used = await prisma.prompt.count({ where: { project: { user_id: userId }, is_active: true, status: "ACTIVE" } })
        if (used + promptCount > 10) throw new Error("Your free trial includes up to 10 prompts. Add a plan or credits to continue.")
    }
    return { allowed: true }
}

// PAYG: no prompt limits — always allow
export async function assertCanCreatePrompts(userId: string, promptCount = 1) {
    const access = await getEffectivePlanAccess(userId)
    const credits = await getCreditBalance(userId)
    if (access.trial.expired && access.effective_plan === Plan.FREE && credits.remaining <= 0) {
        throw new Error("Your free trial has ended. Please upgrade or add credits to add more prompts.")
    }
    if (access.trial.active) {
        const used = await prisma.prompt.count({ where: { project: { user_id: userId }, is_active: true, status: "ACTIVE" } })
        if (used + promptCount > 10) throw new Error("Your free trial includes up to 10 prompts. Add a plan or credits to continue.")
    }
    return { allowed: true }
}

export async function getMyPlan(userId: string): Promise<MyPlanResponse> {
    const access = await getEffectivePlanAccess(userId)
    const { start, end } = await getCurrentPeriod(userId)
    const [liveUsage, monthlyRunsUsed, credits] = await Promise.all([
        getLiveUsageCounts(userId),
        prisma.run.count({
            where: {
                project: { user_id: userId },
                ran_at: { gte: start, lt: end },
            },
        }),
        getCreditBalance(userId),
    ])

    return {
        plan: access.plan,
        effective_plan: access.effective_plan,
        status: access.status,
        subscription: access.subscription,
        trial: access.trial,
        limits: access.limits,
        usage: {
            prompt_count: liveUsage.prompt_count,
            project_count: liveUsage.project_count,
            competitor_count: liveUsage.competitor_count,
            monthly_runs_used: monthlyRunsUsed,
            credits_used: credits.used,
            credits_remaining: credits.remaining,
            period_start: start,
            period_end: end,
        },
    }
}

// ── PAYG: all limit checks always return allowed ─────────────────────────────
// Users are gated by credit balance only, never by plan-based limits.

export async function canCreateProject(userId: string): Promise<LimitCheckResponse> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
    return buildCheck("project", (user?.plan ?? "FREE") as Plan, "unlimited", 0, true)
}

export async function canCreatePrompt(userId: string): Promise<LimitCheckResponse> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
    return buildCheck("prompt", (user?.plan ?? "FREE") as Plan, "unlimited", 0, true)
}

export async function canAddCompetitor(userId: string): Promise<LimitCheckResponse> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
    return buildCheck("competitor", (user?.plan ?? "FREE") as Plan, "unlimited", 0, true)
}

export async function assertCanAddCompetitor(_userId: string) {
    return { allowed: true, feature: "competitor" as const, plan: "FREE" as Plan, limit: "unlimited", used: 0 }
}

export async function assertCanAddCompetitors(_userId: string, _count: number) {
    return { allowed: true }
}

export async function canRunRefresh(userId: string, projectId?: string): Promise<LimitCheckResponse> {
    const access = await getEffectivePlanAccess(userId)
    const credits = await getCreditBalance(userId)

    // If free trial has ended and user has no paid subscription or remaining credits, block runs
    if ((access.trial.expired || (!access.trial.active && access.effective_plan === Plan.FREE)) && credits.remaining <= 0) {
        return buildCheck(
            "refresh",
            Plan.FREE,
            "daily",
            0,
            false,
            "Your free trial has ended. Please upgrade or add credits to continue automated prompt runs."
        )
    }

    if (projectId) {
        const used = await prisma.run.count({
            where: {
                project_id: projectId,
                project: { user_id: userId },
                ran_at: { gte: getRefreshWindowStart() },
            },
        })
        const allowed = used < 1
        return buildCheck("refresh", access.effective_plan, "daily", used, allowed, allowed ? undefined : "This project already refreshed today.")
    }

    return buildCheck("refresh", access.effective_plan, "daily", 0, true)
}

export async function canUseSara(userId: string): Promise<LimitCheckResponse> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
    return buildCheck("sara", (user?.plan ?? "FREE") as Plan, "full", 0, true)
}

export async function canExport(userId: string): Promise<LimitCheckResponse> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true } })
    return buildCheck("export", (user?.plan ?? "FREE") as Plan, "full", 0, true)
}


export async function refreshPlanUsage(userId: string) {
    const { start, end } = await getCurrentPeriod(userId)
    const [projectCount, promptCount, competitorCount, monthlyRunsUsed] = await Promise.all([
        prisma.project.count({ where: { user_id: userId } }),
        prisma.prompt.count({ where: { project: { user_id: userId } } }),
        prisma.competitor.count({ where: { project: { user_id: userId } } }),
        prisma.run.count({
            where: {
                project: { user_id: userId },
                ran_at: { gte: start, lt: end },
            },
        }),
    ])

    return prisma.planUsage.upsert({
        where: {
            user_id_period_start_period_end: {
                user_id: userId,
                period_start: start,
                period_end: end,
            },
        },
        create: {
            user_id: userId,
            project_count: projectCount,
            prompt_count: promptCount,
            competitor_count: competitorCount,
            monthly_runs_used: monthlyRunsUsed,
            period_start: start,
            period_end: end,
        },
        update: {
            project_count: projectCount,
            prompt_count: promptCount,
            competitor_count: competitorCount,
            monthly_runs_used: monthlyRunsUsed,
        },
    })
}

export const getuserplan = getUserPlan
export const getPlanlimits = getPlanLimits
