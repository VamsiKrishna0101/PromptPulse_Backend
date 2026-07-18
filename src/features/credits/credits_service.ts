import { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma"
import { getAccessPeriod, getEffectivePlanAccess } from "../subscription/entitlements"

type CreditMetadata = Prisma.InputJsonValue

type CreditSpendInput = {
    userId: string
    amount: number
    action: string
    description?: string
    idempotencyKey: string
    metadata?: CreditMetadata
}

type CreditRefundInput = {
    userId: string
    amount: number
    action: string
    description?: string
    idempotencyKey: string
    metadata?: CreditMetadata
}

function assertPositiveAmount(amount: number) {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error("Credit amount must be a positive integer")
    }
}

export async function getCreditPeriod(userId: string): Promise<{ start: Date; end: Date }> {
    return getAccessPeriod(userId)
}

export async function getCreditBalance(userId: string) {
    const [access, period] = await Promise.all([
        getEffectivePlanAccess(userId),
        getCreditPeriod(userId),
    ])
    const monthlyCredits = access.limits.credits
    const ledgerEntries = await prisma.creditLedgerEntry.findMany({
        where: {
            user_id: userId,
            period_start: period.start,
            period_end: period.end,
        },
        select: { amount: true },
    })
    const ledgerTotal = ledgerEntries.reduce((total, entry) => total + entry.amount, 0)
    const used = Math.max(0, -ledgerTotal)

    return {
        plan: access.plan,
        effective_plan: access.effective_plan,
        monthly_credits: monthlyCredits,
        used,
        remaining: Math.max(0, monthlyCredits + ledgerTotal),
        period_start: period.start,
        period_end: period.end,
    }
}

export async function spendCredits(input: CreditSpendInput) {
    assertPositiveAmount(input.amount)

    const period = await getCreditPeriod(input.userId)

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existing = await tx.creditLedgerEntry.findUnique({
            where: { idempotency_key: input.idempotencyKey },
        })
        if (existing) {
            if (existing.user_id !== input.userId) {
                throw new Error("Idempotency key already used")
            }
            return existing
        }

        const access = await getEffectivePlanAccess(input.userId)
        const monthlyCredits = access.limits.credits
        const ledgerEntries = await tx.creditLedgerEntry.findMany({
            where: {
                user_id: input.userId,
                period_start: period.start,
                period_end: period.end,
            },
            select: { amount: true },
        })
        const ledgerTotal = ledgerEntries.reduce((total, entry) => total + entry.amount, 0)
        const remaining = monthlyCredits + ledgerTotal

        if (remaining < input.amount) {
            throw new Error(`Not enough credits. You have ${Math.max(0, remaining)} credit${remaining === 1 ? "" : "s"} remaining.`)
        }

        return tx.creditLedgerEntry.create({
            data: {
                user_id: input.userId,
                amount: -input.amount,
                action: input.action,
                description: input.description,
                idempotency_key: input.idempotencyKey,
                metadata: input.metadata,
                period_start: period.start,
                period_end: period.end,
            },
        })
    })
}

export async function refundCredits(input: CreditRefundInput) {
    assertPositiveAmount(input.amount)
    const period = await getCreditPeriod(input.userId)

    return prisma.creditLedgerEntry.upsert({
        where: { idempotency_key: input.idempotencyKey },
        create: {
            user_id: input.userId,
            amount: input.amount,
            action: input.action,
            description: input.description,
            idempotency_key: input.idempotencyKey,
            metadata: input.metadata,
            period_start: period.start,
            period_end: period.end,
        },
        update: {},
    })
}
