import { AccountType, Plan } from "@prisma/client"
import { creditPolicyFor } from "./credits_config"

export type PaidPlan = Exclude<Plan, "FREE">
export type BillingInterval = "monthly" | "annual"

export type BillingPlan = {
    id: PaidPlan
    name: string
    monthly_amount_inr: number
    annual_amount_inr: number
    monthly_credits: number
    base_credits: number
    bonus_credits: number
    detail: string
    expiry: string
}

/**
 * Authoritative INR product catalog.
 * Annual prices are the existing monthly prices with a 10% commitment discount,
 * presented as clean effective-monthly amounts (2249 / 4499 / 8999).
 */
export const BILLING_PLANS: Record<PaidPlan, BillingPlan> = {
    STARTER: {
        id: Plan.STARTER,
        name: "Starter",
        monthly_amount_inr: 2_499,
        annual_amount_inr: 26_988,
        monthly_credits: 2_250,
        base_credits: 2_250,
        bonus_credits: 0,
        detail: "For validating one brand",
        expiry: "Included credits reset each month",
    },
    GROWTH: {
        id: Plan.GROWTH,
        name: "Growth",
        monthly_amount_inr: 4_999,
        annual_amount_inr: 53_988,
        monthly_credits: 5_000,
        base_credits: 4_500,
        bonus_credits: 500,
        detail: "Best-value monthly capacity",
        expiry: "Unused included credits roll over",
    },
    PRO: {
        id: Plan.PRO,
        name: "Pro",
        monthly_amount_inr: 9_999,
        annual_amount_inr: 107_988,
        monthly_credits: 13_000,
        base_credits: 11_250,
        bonus_credits: 1_750,
        detail: "For higher-capacity teams and agencies",
        expiry: "Unused included credits roll over",
    },
}

export function getBillingPlan(plan: PaidPlan) {
    return BILLING_PLANS[plan]
}

export function getPlanAmountInr(plan: PaidPlan, interval: BillingInterval) {
    const item = getBillingPlan(plan)
    // Both monthly and annual intervals are billed monthly, but annual gets a discount
    return interval === "annual" ? Math.floor(item.annual_amount_inr / 12) : item.monthly_amount_inr
}

export function getPlanAmountPaise(plan: PaidPlan, interval: BillingInterval) {
    return getPlanAmountInr(plan, interval) * 100
}

export function getRazorpayPlanId(plan: PaidPlan, interval: BillingInterval) {
    const key = `RAZORPAY_PLAN_${plan}_${interval.toUpperCase()}`
    const id = process.env[key]
    if (!id) throw new Error(`${key} is not configured`)
    return id
}

export function publicBillingCatalog(accountType: AccountType) {
    const policy = creditPolicyFor(accountType)
    return {
        currency: "INR",
        annual_discount_percent: 10,
        account_type: accountType,
        wallet_mode: accountType === AccountType.AGENCY ? "SHARED_AGENCY" : "INDIVIDUAL",
        credit_policy: {
            successful_ai_engine_check: policy.prompt_run,
            seo_provider_credits_per_usd: policy.seo_provider_credits_per_usd,
            site_audit: policy.site_audit,
            failed_provider_run: 0,
            cached_report: 0,
        },
        plans: (accountType === AccountType.AGENCY ? [] : Object.values(BILLING_PLANS)).map(plan => ({
            ...plan,
            annual_effective_monthly_inr: Math.floor(plan.annual_amount_inr / 12),
            annual_credits: plan.monthly_credits * 12,
            annual_credit_delivery: "monthly",
        })),
    }
}
