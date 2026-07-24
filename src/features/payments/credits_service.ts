/**
 * credits_service.ts
 * Core credits engine: check balance, deduct, award, and fetch history.
 */

import prisma from "../../lib/prisma"
import { CREDIT_ACTIONS, LOW_BALANCE_THRESHOLD, type CreditAction } from "./credits_config"

export async function resolveBillingUserId(userId: string): Promise<string> {
    const agency = await prisma.user.findUnique({ where: { id: userId }, select: { account_type: true } })
    if (agency?.account_type === "AGENCY") return userId
    const membership = await prisma.agencyMembership.findFirst({ where: { member_user_id: userId, status: "ACTIVE" }, select: { agency_user_id: true } })
    if (membership) return membership.agency_user_id
    const clientLink = await prisma.agencyClientLink.findFirst({ where: { client_user_id: userId, status: "ACTIVE" }, select: { agency_user_id: true } })
    return clientLink?.agency_user_id ?? userId
}

export async function expireCreditBuckets(userId: string) {
    const now = new Date()
    const expired = await prisma.creditBucket.findMany({ where: { user_id: userId, amount_remaining: { gt: 0 }, expires_at: { lte: now } }, select: { id: true, amount_remaining: true, source: true } })
    if (!expired.length) return 0
    const amount = expired.reduce((sum, bucket) => sum + bucket.amount_remaining, 0)
    await prisma.$transaction(async tx => {
        await tx.creditBucket.updateMany({ where: { id: { in: expired.map(bucket => bucket.id) } }, data: { amount_remaining: 0 } })
        await tx.user.update({ where: { id: userId }, data: { credits_balance: { decrement: amount } } })
        await tx.creditTransaction.create({ data: { user_id: userId, amount: -amount, action: "CREDIT_EXPIRY", description: `${expired.map(bucket => bucket.source).join(", ")} credits expired`, metadata: { expired_at: now.toISOString() } } })
    })
    return amount
}

export async function createCreditBucket(userId: string, amount: number, source: string, expiresAt: Date | null = null) {
    if (amount <= 0) return
    await prisma.creditBucket.create({ data: { user_id: userId, amount_remaining: amount, source, expires_at: expiresAt } })
}

export class InsufficientCreditsError extends Error {
    constructor(required: number, available: number) {
        super(`Insufficient credits: need ${required}, have ${available}`)
        this.name = "InsufficientCreditsError"
    }
}

/**
 * Get the current credit balance for a user.
 */
export async function getCreditBalance(userId: string): Promise<number> {
    const billingUserId = await resolveBillingUserId(userId)
    await expireCreditBuckets(billingUserId)
    const user = await prisma.user.findUnique({
        where:  { id: billingUserId },
        select: { credits_balance: true },
    })
    return user?.credits_balance ?? 0
}

/**
 * Assert that the user has enough credits for an action.
 * Throws InsufficientCreditsError if not.
 */
export async function assertCredits(userId: string, action: CreditAction): Promise<void> {
    const cost    = CREDIT_ACTIONS[action]
    const balance = await getCreditBalance(userId)
    if (balance < cost) throw new InsufficientCreditsError(cost, balance)
}

/**
 * Deduct credits for an action in a single atomic transaction.
 * Returns the new balance.
 */
export async function deductCredits(
    userId:      string,
    action:      CreditAction,
    description?: string,
    metadata?:   Record<string, unknown>,
): Promise<number> {
    const cost    = CREDIT_ACTIONS[action]
    const billingUserId = await resolveBillingUserId(userId)
    const balance = await getCreditBalance(billingUserId)

    if (balance < cost) throw new InsufficientCreditsError(cost, balance)

    const [updatedUser] = await prisma.$transaction([
        prisma.user.update({
            where: { id: billingUserId },
            data:  { credits_balance: { decrement: cost } },
            select: { credits_balance: true },
        }),
        prisma.creditTransaction.create({
            data: {
                user_id:     billingUserId,
                amount:      -cost,
                action,
                description: description ?? action,
                metadata:    metadata ? (metadata as any) : undefined,
            },
        }),
    ])

    return updatedUser.credits_balance
}

/**
 * Add credits to the user's wallet (e.g., after a Razorpay top-up or signup bonus).
 * Returns the new balance.
 */
export async function awardCredits(
    userId:      string,
    amount:      number,
    action:      string,
    description?: string,
    metadata?:   Record<string, unknown>,
): Promise<number> {
    const billingUserId = await resolveBillingUserId(userId)
    await expireCreditBuckets(billingUserId)
    const [updatedUser] = await prisma.$transaction([
        prisma.user.update({
            where: { id: billingUserId },
            data:  { credits_balance: { increment: amount } },
            select: { credits_balance: true },
        }),
        prisma.creditTransaction.create({
            data: {
                user_id:     billingUserId,
                amount:      +amount,
                action,
                description: description ?? action,
                metadata:    metadata ? (metadata as any) : undefined,
            },
        }),
    ])

    await createCreditBucket(billingUserId, amount, action, null)

    return updatedUser.credits_balance
}

/**
 * Ensure a verified free-trial user has their one-time signup bonus.
 * This prevents onboarding from dead-ending when a user reaches the first run
 * before the verification/login credit-award path has refreshed their wallet.
 */
export async function ensureSignupBonusCredits(userId: string): Promise<number> {
    const billingUserId = await resolveBillingUserId(userId)
    await expireCreditBuckets(billingUserId)

    const user = await prisma.user.findUnique({
        where: { id: billingUserId },
        select: { credits_balance: true, is_verified: true },
    })

    if (!user) return 0
    if (!user.is_verified) return user.credits_balance

    const existingBonus = await prisma.creditTransaction.findFirst({
        where: {
            user_id: billingUserId,
            action: "SIGNUP_BONUS",
        },
        select: { id: true },
    })

    if (existingBonus) return user.credits_balance
    if (user.credits_balance > 0) return user.credits_balance

    return awardCredits(
        billingUserId,
        CREDIT_ACTIONS.SIGNUP_BONUS,
        "SIGNUP_BONUS",
        `${CREDIT_ACTIONS.SIGNUP_BONUS} free trial credits`,
        { source: "trial_onboarding_guard" },
    )
}

/**
 * Returns whether the user's balance is below the low-balance warning threshold.
 */
export async function isLowBalance(userId: string): Promise<boolean> {
    const balance = await getCreditBalance(userId)
    return balance < LOW_BALANCE_THRESHOLD
}

/**
 * Fetch paginated credit transaction history for a user.
 */
export async function getCreditTransactions(
    userId: string,
    page:   number = 1,
    limit:  number = 20,
    options: { days?: number; type?: "all" | "credit" | "debit" } = {},
): Promise<{ transactions: object[]; total: number }> {
    const billingUserId = await resolveBillingUserId(userId)
    const skip = (page - 1) * limit
    const safeDays = options.days ? Math.min(Math.max(options.days, 1), 30) : undefined
    const createdAt = safeDays
        ? { gte: new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000) }
        : undefined
    const amount = options.type === "credit"
        ? { gt: 0 }
        : options.type === "debit"
            ? { lt: 0 }
            : undefined
    const where = {
        user_id: billingUserId,
        ...(createdAt ? { created_at: createdAt } : {}),
        ...(amount ? { amount } : {}),
    }

    const [transactions, total] = await Promise.all([
        prisma.creditTransaction.findMany({
            where,
            orderBy: { created_at: "desc" },
            skip,
            take:    limit,
            select: {
                id:          true,
                amount:      true,
                action:      true,
                description: true,
                metadata:    true,
                created_at:  true,
            },
        }),
        prisma.creditTransaction.count({ where }),
    ])

    return { transactions, total }
}
