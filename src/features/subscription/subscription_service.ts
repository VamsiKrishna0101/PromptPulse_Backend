import Stripe from "stripe"
import { Plan, SubscriptionStatus } from "@prisma/client"
import prisma from "../../lib/prisma"
import type {
    CreateSubscriptionInput,
    CreateSubscriptionResponse,
    LimitCheckResponse,
    MyPlanResponse,
    PaidPlan,
    PlanLimits,
    SubscriptionLimitFeature,
} from "./subscription_types"

let stripeClient: Stripe | null = null
const TRIAL_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

function getStripeClient(): Stripe {
    if (stripeClient) return stripeClient

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY
    if (!stripeSecretKey) {
        throw new Error("STRIPE_SECRET_KEY is required")
    }

    stripeClient = new Stripe(stripeSecretKey)
    return stripeClient
}

const PLAN_CONFIG: Record<PaidPlan, { amount_cents: number; price_env_key: string }> = {
    STARTER: {
        amount_cents: 1900,
        price_env_key: "STRIPE_STARTER_PRICE_ID",
    },
    GROWTH: {
        amount_cents: 3900,
        price_env_key: "STRIPE_GROWTH_PRICE_ID",
    },
    PRO: {
        amount_cents: 9900,
        price_env_key: "STRIPE_PRO_PRICE_ID",
    },
}

const ACCESS_STATUSES: SubscriptionStatus[] = [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.PAST_DUE,
]

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
    FREE: {
        projects: 0,
        prompts: 0,
        competitors: 0,
        refreshes_per_week: 0,
        sara: "none",
        exports: "none",
    },
    STARTER: {
        projects: 1,
        prompts: 20,
        competitors: 3,
        refreshes_per_week: 2,
        sara: "none",
        exports: "none",
    },
    GROWTH: {
        projects: 2,
        prompts: 50,
        competitors: 6,
        refreshes_per_week: "daily",
        sara: "full",
        exports: "basic",
    },
    PRO: {
        projects: 5,
        prompts: 125,
        competitors: 15,
        refreshes_per_week: "daily",
        sara: "advanced",
        exports: "full",
    },
}

function assertPaidPlan(plan: unknown): asserts plan is PaidPlan {
    if (plan !== Plan.STARTER && plan !== Plan.GROWTH && plan !== Plan.PRO) {
        throw new Error("Invalid subscription plan")
    }
}

function getPriceId(plan: PaidPlan): string {
    const priceId = process.env[PLAN_CONFIG[plan].price_env_key]
    if (!priceId) {
        throw new Error(`${PLAN_CONFIG[plan].price_env_key} is required`)
    }
    return priceId
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

function addTrialDays(date: Date): Date {
    return new Date(date.getTime() + TRIAL_DAYS * MS_PER_DAY)
}

function getStripeId(value: string | { id: string } | null | undefined): string | null {
    if (!value) return null
    return typeof value === "string" ? value : value.id
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

async function getCurrentPeriod(userId: string): Promise<{ start: Date; end: Date }> {
    const subscription = await prisma.subscription.findFirst({
        where: {
            user_id: userId,
            status: {
                in: ACCESS_STATUSES,
            },
        },
        orderBy: { created_at: "desc" },
        select: { current_period_start: true, current_period_end: true },
    })

    const now = new Date()
    const start = subscription?.current_period_start ?? new Date(now.getFullYear(), now.getMonth(), 1)
    const end = subscription?.current_period_end ?? new Date(now.getFullYear(), now.getMonth() + 1, 1)

    return { start, end }
}

export async function createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResponse> {
    assertPaidPlan(input.plan)
    const stripe = getStripeClient()

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
    const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.id,
        line_items: [
            {
                price: getPriceId(input.plan),
                quantity: 1,
            },
        ],
        success_url: process.env.STRIPE_CHECKOUT_SUCCESS_URL ?? `${frontendUrl}/dashboard?subscription=success`,
        cancel_url: process.env.STRIPE_CHECKOUT_CANCEL_URL ?? `${frontendUrl}/dashboard?subscription=cancelled`,
        metadata: {
            user_id: user.id,
            plan: input.plan,
        },
        subscription_data: {
            trial_period_days: TRIAL_DAYS,
            metadata: {
                user_id: user.id,
                plan: input.plan,
            },
        },
        allow_promotion_codes: true,
    })

    const trialStartsAt = new Date()
    await prisma.subscription.create({
        data: {
            user_id: user.id,
            plan: input.plan,
            status: SubscriptionStatus.INCOMPLETE,
            amount_cents: PLAN_CONFIG[input.plan].amount_cents,
            stripe_customer_id: customerId,
            trial_starts_at: trialStartsAt,
            trial_ends_at: addTrialDays(trialStartsAt),
        },
    })

    if (!session.url) {
        throw new Error("Stripe checkout session URL was not created")
    }

    return {
        checkout_session_id: session.id,
        checkout_url: session.url,
        plan: input.plan,
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
                amount_cents: PLAN_CONFIG[plan].amount_cents,
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
                amount_cents: PLAN_CONFIG[plan].amount_cents,
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

export async function handleStripeWebhook(rawBody: Buffer | string, signature: string | undefined) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
        throw new Error("STRIPE_WEBHOOK_SECRET is required")
    }
    if (!signature) {
        throw new Error("Missing Stripe signature")
    }

    const stripe = getStripeClient()
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)

    if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session
        const subscriptionId = getStripeId(session.subscription)

        if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId)
            await syncSubscriptionFromStripe(subscription)
        }
    }

    if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
    ) {
        await syncSubscriptionFromStripe(event.data.object as Stripe.Subscription)
    }

    if (event.type === "invoice.payment_succeeded" || event.type === "invoice.payment_failed") {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } | null }
        const subscriptionId = getStripeId(invoice.subscription)

        if (subscriptionId) {
            const subscription = await stripe.subscriptions.retrieve(subscriptionId)
            await syncSubscriptionFromStripe(subscription)
        }
    }

    return { received: true, event_type: event.type }
}

export async function getUserPlan(userId: string): Promise<Plan> {
    const subscription = await prisma.subscription.findFirst({
        where: {
            user_id: userId,
            status: {
                in: ACCESS_STATUSES,
            },
        },
        orderBy: { created_at: "desc" },
        select: { plan: true },
    })

    if (!subscription) {
        return Plan.FREE
    }

    return subscription.plan
}

export async function getPlanLimits(userId: string): Promise<PlanLimits> {
    const plan = await getUserPlan(userId)
    return PLAN_LIMITS[plan]
}

export async function getMyPlan(userId: string): Promise<MyPlanResponse> {
    const subscription = await prisma.subscription.findFirst({
        where: {
            user_id: userId,
            status: {
                in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE, SubscriptionStatus.INCOMPLETE],
            },
        },
        orderBy: { created_at: "desc" },
        select: {
            id: true,
            plan: true,
            status: true,
            current_period_start: true,
            current_period_end: true,
            cancel_at_period_end: true,
            trial_starts_at: true,
            trial_ends_at: true,
        },
    })

    const plan = subscription?.status === SubscriptionStatus.INCOMPLETE
        ? Plan.FREE
        : subscription?.plan ?? Plan.FREE

    const usage = await prisma.planUsage.findFirst({
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
    })

    return {
        plan,
        status: subscription?.status ?? "FREE",
        subscription,
        limits: PLAN_LIMITS[plan],
        usage: usage ?? {
            prompt_count: 0,
            project_count: 0,
            competitor_count: 0,
            monthly_runs_used: 0,
            period_start: null,
            period_end: null,
        },
    }
}

export async function canCreateProject(userId: string): Promise<LimitCheckResponse> {
    const plan = await getUserPlan(userId)
    const limit = PLAN_LIMITS[plan].projects
    const used = await prisma.project.count({ where: { user_id: userId } })
    const allowed = used < limit

    return buildCheck("project", plan, limit, used, allowed, allowed ? undefined : "Project limit reached")
}

export async function canCreatePrompt(userId: string): Promise<LimitCheckResponse> {
    const plan = await getUserPlan(userId)
    const limit = PLAN_LIMITS[plan].prompts
    const used = await prisma.prompt.count({
        where: {
            project: {
                user_id: userId,
            },
        },
    })
    const allowed = used < limit

    return buildCheck("prompt", plan, limit, used, allowed, allowed ? undefined : "Prompt limit reached")
}

export async function canAddCompetitor(userId: string): Promise<LimitCheckResponse> {
    const plan = await getUserPlan(userId)
    const limit = PLAN_LIMITS[plan].competitors
    const used = await prisma.competitor.count({
        where: {
            project: {
                user_id: userId,
            },
        },
    })
    const allowed = used < limit

    return buildCheck("competitor", plan, limit, used, allowed, allowed ? undefined : "Competitor limit reached")
}

export async function canRunRefresh(userId: string): Promise<LimitCheckResponse> {
    const plan = await getUserPlan(userId)
    const limit = PLAN_LIMITS[plan].refreshes_per_week

    if (limit === "daily") {
        return buildCheck("refresh", plan, "daily", 0, true)
    }

    const since = new Date()
    since.setDate(since.getDate() - 7)

    const used = await prisma.run.count({
        where: {
            project: {
                user_id: userId,
            },
            ran_at: {
                gte: since,
            },
        },
    })
    const allowed = used < limit

    return buildCheck("refresh", plan, limit, used, allowed, allowed ? undefined : "Weekly refresh limit reached")
}

export async function canUseSara(userId: string): Promise<LimitCheckResponse> {
    const plan = await getUserPlan(userId)
    const saraAccess = PLAN_LIMITS[plan].sara
    const allowed = saraAccess !== "none"

    return buildCheck("sara", plan, saraAccess, 0, allowed, allowed ? undefined : "Sara is not included in this plan")
}

export async function canExport(userId: string): Promise<LimitCheckResponse> {
    const plan = await getUserPlan(userId)
    const exportAccess = PLAN_LIMITS[plan].exports
    const allowed = exportAccess !== "none"

    return buildCheck("export", plan, exportAccess, 0, allowed, allowed ? undefined : "Exports are not included in this plan")
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
