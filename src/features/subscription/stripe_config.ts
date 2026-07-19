import Stripe from "stripe"
import type { BillingInterval, PaidPlan } from "./subscription_types"

let stripeClient: Stripe | null = null

const PRICES: Record<PaidPlan, Record<BillingInterval, { amount_cents: number; env: string; legacy_env?: string }>> = {
    STARTER: {
        monthly: { amount_cents: 2900, env: "STRIPE_STARTER_MONTHLY_PRICE_ID", legacy_env: "STRIPE_STARTER_PRICE_ID" },
        annual: { amount_cents: 27840, env: "STRIPE_STARTER_ANNUAL_PRICE_ID" },
    },
    GROWTH: {
        monthly: { amount_cents: 5900, env: "STRIPE_GROWTH_MONTHLY_PRICE_ID", legacy_env: "STRIPE_GROWTH_PRICE_ID" },
        annual: { amount_cents: 56640, env: "STRIPE_GROWTH_ANNUAL_PRICE_ID" },
    },
    PRO: {
        monthly: { amount_cents: 12900, env: "STRIPE_PRO_MONTHLY_PRICE_ID", legacy_env: "STRIPE_PRO_PRICE_ID" },
        annual: { amount_cents: 123840, env: "STRIPE_PRO_ANNUAL_PRICE_ID" },
    },
}

export function getStripeClient() {
    if (stripeClient) return stripeClient
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error("STRIPE_SECRET_KEY is required")
    stripeClient = new Stripe(key)
    return stripeClient
}

export function getStripePrice(plan: PaidPlan, interval: BillingInterval) {
    const config = PRICES[plan][interval]
    const priceId = process.env[config.env] ?? (config.legacy_env ? process.env[config.legacy_env] : undefined)
    if (!priceId) throw new Error(`${config.env} is required`)
    return { price_id: priceId, amount_cents: config.amount_cents }
}

export function getStripeId(value: string | { id: string } | null | undefined): string | null {
    if (!value) return null
    return typeof value === "string" ? value : value.id
}
