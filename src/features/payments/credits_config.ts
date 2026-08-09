/**
 * credits_config.ts
 * Centralized configuration for all credit costs in the PAYG system.
 * 1 credit = ₹1 (for packs), or a configurable rate set via env.
 */

import { AccountType } from "@prisma/client"

/** Central product policy. Always resolve the billing owner's account type. */
export const ACCOUNT_CREDIT_POLICY = {
    [AccountType.SINGLE]: {
        prompt_run: 1,
        seo_provider_credits_per_usd: 180,
        site_audit: { quick: 4, standard: 8, deep: 15 },
    },
    [AccountType.AGENCY]: {
        prompt_run: 1,
        seo_provider_credits_per_usd: 150,
        site_audit: { quick: 3, standard: 6, deep: 12 },
    },
} as const

export function creditPolicyFor(accountType: AccountType) {
    return ACCOUNT_CREDIT_POLICY[accountType]
}

export function signupBonusFor(accountType: AccountType) {
    return 105 * creditPolicyFor(accountType).prompt_run
}

export const CREDIT_ACTIONS = {
    // One successful prompt on one engine
    PROMPT_RUN:       1,
    SARA_MESSAGE:     1,  // One Sara AI message exchange
    EXPORT:           1,  // One data export (PDF / Excel)

    // Heavy actions — 5 credits each
    REDDIT_SCAN_STANDARD: 5,   // Standard Reddit Intelligence scan
    REDDIT_SCAN_DEEP:     5,   // Deep Reddit Intelligence scan

    // Site audits — tiered by depth (account-aware; actual cost resolved at runtime)
    SEO_SITE_AUDIT:        10, // placeholder; real cost from getSiteAuditCreditCost()
    SEO_SITE_AUDIT_REFUND: 0,  // refund marker, never directly deducted

    // Signup bonus (positive credit awards)
    SIGNUP_BONUS:     105, // 5 prompts × 3 engines × 7 trial days
} as const

export type CreditAction = keyof typeof CREDIT_ACTIONS

/**
 * Credit pack options available for purchase via Razorpay.
 * amount_inr_paise: price in paise (₹1 = 100 paise)
 * credits: number of credits awarded
 * bonus_credits: additional bonus on top
 */
export const CREDIT_PACKS = [
    {
        id:               "pack_1000",
        label:            "1,000 Credits",
        amount_inr:       999,
        amount_inr_paise: 99_900,
        credits:          1_000,
        bonus_credits:    0,
    },
    {
        id:               "pack_3000",
        label:            "3,000 Credits",
        amount_inr:       2499,
        amount_inr_paise: 249_900,
        credits:          3_000,
        bonus_credits:    0,
    },
    {
        id:               "pack_10000",
        label:            "10,000 Credits",
        amount_inr:       7999,
        amount_inr_paise: 799_900,
        credits:          10_000,
        bonus_credits:    0,
    },
] as const

/** Agency-only volume packs. The wallet is shared by the agency owner and all
 * active team/client links, while usage remains attributed to the actor/client. */
export const AGENCY_CREDIT_PACKS = [
    {
        id:               "agency_1000",
        label:            "1,000 Agency Credits",
        amount_inr:       999,
        amount_inr_paise: 99_900,
        credits:          1_000,
        bonus_credits:    0,
    },
    {
        id:               "agency_3000",
        label:            "3,000 Agency Credits",
        amount_inr:       2_299,
        amount_inr_paise: 229_900,
        credits:          3_000,
        bonus_credits:    0,
    },
    {
        id:               "agency_7500",
        label:            "7,500 Agency Credits",
        amount_inr:       5_499,
        amount_inr_paise: 549_900,
        credits:          7_500,
        bonus_credits:    0,
    },
    {
        id:               "agency_15000",
        label:            "15,000 Agency Credits",
        amount_inr:       10_499,
        amount_inr_paise: 1_049_900,
        credits:          15_000,
        bonus_credits:    0,
    },
] as const

export type CreditPackId = (typeof CREDIT_PACKS)[number]["id"]

export function getCreditPack(id: string) {
    return [...CREDIT_PACKS, ...AGENCY_CREDIT_PACKS].find(p => p.id === id) ?? null
}

export function getCustomCreditPack(credits: number, accountType: AccountType = AccountType.SINGLE) {
    if (!Number.isInteger(credits) || credits < 1_000 || credits > 1_000_000) return null
    const agencyRate = credits >= 15_000 ? 0.70 : credits >= 7_500 ? 0.7332 : credits >= 3_000 ? 0.7664 : 0.999
    const rate = accountType === AccountType.AGENCY ? agencyRate : 0.999
    const amountInr = Math.ceil(credits * rate)
    return {
        id: `custom_${credits}`,
        label: `${credits.toLocaleString("en-IN")} Credits`,
        amount_inr: amountInr,
        amount_inr_paise: amountInr * 100,
        credits,
        bonus_credits: 0,
    }
}

/** Minimum balance below which we show a low-balance warning in the UI */
export const LOW_BALANCE_THRESHOLD = 50
