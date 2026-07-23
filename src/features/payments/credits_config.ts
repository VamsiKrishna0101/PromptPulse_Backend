/**
 * credits_config.ts
 * Centralized configuration for all credit costs in the PAYG system.
 * 1 credit = ₹1 (for packs), or a configurable rate set via env.
 */

export const CREDIT_ACTIONS = {
    // One successful prompt on one engine
    PROMPT_RUN:       1,
    SARA_MESSAGE:     1,  // One Sara AI message exchange
    EXPORT:           1,  // One data export (PDF / Excel)

    // Heavy actions — 5 credits each
    REDDIT_SCAN_STANDARD: 5,   // Standard Reddit Intelligence scan
    REDDIT_SCAN_DEEP:     5,   // Deep Reddit Intelligence scan

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

export type CreditPackId = (typeof CREDIT_PACKS)[number]["id"]

export function getCreditPack(id: string) {
    return CREDIT_PACKS.find(p => p.id === id) ?? null
}

export function getCustomCreditPack(credits: number) {
    if (!Number.isInteger(credits) || credits < 1_000 || credits > 1_000_000) return null
    const amountInr = Math.ceil(credits * 0.999)
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
