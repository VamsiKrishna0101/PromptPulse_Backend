/**
 * credits_service.ts (features/credits)
 * 
 * Unified credit service for the PAYG model.
 * Redirects all spendCredits / refundCredits calls to the new
 * User.credits_balance wallet (CreditTransaction ledger).
 * 
 * The old CreditLedgerEntry system (plan-based monthly credits) is no longer
 * the primary mechanism — this shim ensures all existing callers work without
 * being changed individually.
 */

import prisma from "../../lib/prisma"
import { InsufficientCreditsError, resolveBillingUserId } from "../payments/credits_service"

type CreditMetadata = Record<string, unknown>

type CreditSpendInput = {
    userId:         string
    amount:         number
    action:         string
    description?:   string
    idempotencyKey: string
    metadata?:      CreditMetadata
}

type CreditRefundInput = {
    userId:         string
    amount:         number
    action:         string
    description?:   string
    idempotencyKey: string
    metadata?:      CreditMetadata
}

function assertPositiveAmount(amount: number) {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error("Credit amount must be a positive integer")
    }
}

/**
 * Spend credits from the user's PAYG wallet.
 * Idempotent: if a CreditTransaction with this idempotencyKey already exists, it is a no-op.
 */
export async function spendCredits(input: CreditSpendInput) {
    assertPositiveAmount(input.amount)
    const billingUserId = await resolveBillingUserId(input.userId)

    // Idempotency: check if already processed
    const existing = await prisma.creditTransaction.findFirst({
        where: { user_id: billingUserId, metadata: { path: ["idempotency_key"], equals: input.idempotencyKey } },
    })
    if (existing) return existing

    const user = await prisma.user.findUnique({ where: { id: billingUserId }, select: { credits_balance: true } })
    const balance = user?.credits_balance ?? 0

    if (balance < input.amount) {
        throw new InsufficientCreditsError(input.amount, balance)
    }

    const [, transaction] = await prisma.$transaction(async tx => {
        const buckets = await tx.creditBucket.findMany({ where: { user_id: billingUserId, amount_remaining: { gt: 0 } }, orderBy: { created_at: "asc" } })
        let remaining = input.amount
        for (const bucket of buckets.sort((a, b) => Number(a.expires_at === null) - Number(b.expires_at === null))) {
            if (remaining <= 0) break
            const used = Math.min(bucket.amount_remaining, remaining)
            await tx.creditBucket.update({ where: { id: bucket.id }, data: { amount_remaining: { decrement: used } } })
            remaining -= used
        }
        const updatedUser = await tx.user.update({ where: { id: billingUserId }, data: { credits_balance: { decrement: input.amount } } })
        const creditTransaction = await tx.creditTransaction.create({ data: { user_id: billingUserId, amount: -input.amount, action: input.action, description: input.description ?? input.action, metadata: { idempotency_key: input.idempotencyKey, actor_user_id: input.userId, ...(input.metadata ?? {}) } } })
        return [updatedUser, creditTransaction] as const
    })

    return transaction
}

/**
 * Refund credits back to the user's PAYG wallet.
 * Idempotent: if already refunded, this is a no-op.
 */
export async function refundCredits(input: CreditRefundInput) {
    assertPositiveAmount(input.amount)
    const billingUserId = await resolveBillingUserId(input.userId)

    const refundKey = `refund:${input.idempotencyKey}`
    const existing = await prisma.creditTransaction.findFirst({
        where: { user_id: billingUserId, metadata: { path: ["idempotency_key"], equals: refundKey } },
    })
    if (existing) return existing

    const [, transaction] = await prisma.$transaction([
        prisma.user.update({
            where: { id: billingUserId },
            data:  { credits_balance: { increment: input.amount } },
        }),
        prisma.creditTransaction.create({
            data: {
                user_id:     billingUserId,
                amount:      +input.amount,
                action:      `REFUND_${input.action}`,
                description: input.description ?? `Refund: ${input.action}`,
                metadata:    { idempotency_key: refundKey, original_key: input.idempotencyKey, actor_user_id: input.userId, ...(input.metadata ?? {}) },
            },
        }),
    ])

    await prisma.creditBucket.create({ data: { user_id: billingUserId, amount_remaining: input.amount, source: `REFUND_${input.action}`, expires_at: null } })

    return transaction
}

/**
 * Get current credit balance for a user.
 * Returns a shape compatible with the old plan-based balance response
 * so existing callers don't break.
 */
export async function getCreditBalance(userId: string) {
    const billingUserId = await resolveBillingUserId(userId)
    const user = await prisma.user.findUnique({ where: { id: billingUserId }, select: { credits_balance: true, plan: true } })
    const balance = user?.credits_balance ?? 0

    return {
        plan:            user?.plan ?? "FREE",
        effective_plan:  user?.plan ?? "FREE",
        monthly_credits: balance, // expose balance as "monthly_credits" for backward compat
        used:            0,       // legacy field - not tracked anymore
        remaining:       balance,
        period_start:    null,
        period_end:      null,
    }
}

/** Legacy shim - no longer used for period-based access */
export async function getCreditPeriod(_userId: string): Promise<{ start: Date; end: Date }> {
    const now   = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return { start, end }
}
