/**
 * razorpay_service.ts
 * Handles Razorpay order creation, signature verification, credit top-ups,
 * and monthly credit-plan purchases.
 */

import crypto from "crypto"
import { Plan, SubscriptionStatus, type RazorpayOrder } from "@prisma/client"
import prisma from "../../lib/prisma"
import { getRazorpayClient } from "./razorpay_config"
import { AGENCY_CREDIT_PACKS, getCreditPack, getCustomCreditPack } from "./credits_config"
import { getBillingAudience } from "./razorpay_subscription_service"
import { PLAN_LIMITS } from "../subscription/plan_config"
import { resolveBillingUserId } from "./credits_service"

const PLAN_CREDIT_BUNDLES: Record<Exclude<Plan, "FREE">, { amount_inr: number; amount_inr_paise: number }> = {
    STARTER: { amount_inr: 2499, amount_inr_paise: 249_900 },
    GROWTH:  { amount_inr: 4999, amount_inr_paise: 499_900 },
    PRO:     { amount_inr: 9999, amount_inr_paise: 999_900 },
}

function assertPaidPlan(plan: unknown): asserts plan is Exclude<Plan, "FREE"> {
    if (plan !== Plan.STARTER && plan !== Plan.GROWTH && plan !== Plan.PRO) {
        throw new Error("Invalid credit plan")
    }
}

function addMonthlyPeriod(date: Date) {
    const end = new Date(date)
    end.setMonth(end.getMonth() + 1)
    return end
}

function getPlanFromOrder(order: RazorpayOrder): Exclude<Plan, "FREE"> | null {
    const [, , plan] = order.idempotency_key?.split(":") ?? []
    if (plan === Plan.STARTER || plan === Plan.GROWTH || plan === Plan.PRO) return plan
    return null
}

async function markOrderPaidAndApplyBenefits(order: RazorpayOrder, razorpayPaymentId: string, source: "verify" | "webhook") {
    const plan = getPlanFromOrder(order)
    const now = new Date()
    const periodEnd = addMonthlyPeriod(now)
    const action = plan ? "PLAN_CREDITS" : "TOPUP"
    const description = plan
        ? `PromptPulse ${plan.toLowerCase()} monthly credits - ${order.credits_to_award} credits`
        : `Razorpay top-up - INR ${order.amount_inr_paise / 100} - ${order.credits_to_award} credits`

    const result = await prisma.$transaction(async tx => {
        const marked = await tx.razorpayOrder.updateMany({
            where: { id: order.id, status: "PENDING" },
            data: {
                status: "PAID",
                razorpay_payment_id: razorpayPaymentId,
                updated_at: now,
            },
        })

        if (marked.count === 0) {
            const user = await tx.user.findUniqueOrThrow({
                where: { id: order.user_id },
                select: { credits_balance: true },
            })
            return { user, applied: false }
        }

        const user = await tx.user.update({
            where: { id: order.user_id },
            data: {
                credits_balance: { increment: order.credits_to_award },
                ...(plan ? { plan } : {}),
            },
            select: { credits_balance: true },
        })

        await tx.creditTransaction.create({
            data: {
                user_id: order.user_id,
                idempotency_key: `${action}:${order.razorpay_order_id}`,
                amount: order.credits_to_award,
                action,
                description,
                metadata: {
                    idempotency_key: `${action}:${order.razorpay_order_id}`,
                    razorpay_order_id: order.razorpay_order_id,
                    razorpay_payment_id: razorpayPaymentId,
                    source,
                    ...(plan ? { plan, period_start: now.toISOString(), period_end: periodEnd.toISOString() } : {}),
                },
            },
        })

        await tx.creditBucket.create({
            data: {
                user_id: order.user_id,
                amount_remaining: order.credits_to_award,
                source: plan ? `${plan}_INCLUDED` : "PAYG",
                expires_at: plan === Plan.STARTER ? periodEnd : null,
            },
        })

        if (plan) {
            await tx.subscription.create({
                data: {
                    user_id: order.user_id,
                    plan,
                    status: SubscriptionStatus.ACTIVE,
                    amount_cents: order.amount_inr_paise,
                    currency: "inr",
                    current_period_start: now,
                    current_period_end: periodEnd,
                    trial_starts_at: now,
                    trial_ends_at: null,
                    billing_interval: "monthly",
                },
            })
        }

        return { user, applied: true }
    })

    return {
        credits_awarded: result.applied ? order.credits_to_award : 0,
        new_balance: result.user.credits_balance,
        plan,
    }
}

/**
 * Creates a Razorpay order for a credit pack, custom top-up, or monthly credit plan.
 * Returns the order details the frontend needs to open the payment modal.
 */
export async function createRazorpayOrder(userId: string, packId?: string, customCredits?: number, planId?: Plan) {
    userId = await resolveBillingUserId(userId)
    if (planId) {
        assertPaidPlan(planId)
        const planPrice = PLAN_CREDIT_BUNDLES[planId]
        const credits = PLAN_LIMITS[planId].credits
        const razorpay = getRazorpayClient()
        const idempotencyKey = `plan:${userId}:${planId}:${Date.now()}`

        const order = await (razorpay.orders as any).create({
            amount: planPrice.amount_inr_paise,
            currency: "INR",
            receipt: idempotencyKey.slice(0, 40),
            notes: {
                user_id: userId,
                order_kind: "PLAN_CREDITS",
                plan_id: planId,
                credits_to_award: String(credits),
            },
        })

        await prisma.razorpayOrder.create({
            data: {
                user_id: userId,
                razorpay_order_id: order.id,
                amount_inr_paise: planPrice.amount_inr_paise,
                credits_to_award: credits,
                status: "PENDING",
                idempotency_key: idempotencyKey,
            },
        })

        return {
            razorpay_order_id: order.id,
            amount_inr_paise: planPrice.amount_inr_paise,
            credits_to_award: credits,
            key_id: process.env.RAZORPAY_KEY_ID ?? "",
            pack: {
                id: `plan_${planId.toLowerCase()}`,
                label: `${planId} Monthly Credits`,
                amount_inr: planPrice.amount_inr,
                credits,
                bonus_credits: 0,
            },
            plan: planId,
        }
    }

    const audience = await getBillingAudience(userId)
    const pack = packId ? getCreditPack(packId) : getCustomCreditPack(customCredits ?? 0, audience)
    if (!pack) throw new Error("Invalid credit pack")
    if (AGENCY_CREDIT_PACKS.some(item => item.id === pack.id) && audience !== "AGENCY") {
        throw new Error("Agency credit packs require an agency account")
    }
    if (CREDIT_PACKS.some(item => item.id === pack.id) && audience === "AGENCY") {
        throw new Error("Choose an agency credit pack for this shared wallet")
    }

    const razorpay = getRazorpayClient()
    const idempotencyKey = `topup:${userId}:${packId ?? pack.id}:${Date.now()}`

    const order = await (razorpay.orders as any).create({
        amount:   pack.amount_inr_paise,
        currency: "INR",
        receipt:  idempotencyKey.slice(0, 40),
        notes: {
            user_id:          userId,
            order_kind:       "TOPUP",
            pack_id:          packId ?? pack.id,
            credits_to_award: String(pack.credits + pack.bonus_credits),
        },
    })

    await prisma.razorpayOrder.create({
        data: {
            user_id:           userId,
            razorpay_order_id: order.id,
            amount_inr_paise:  pack.amount_inr_paise,
            credits_to_award:  pack.credits + pack.bonus_credits,
            status:            "PENDING",
            idempotency_key:   idempotencyKey,
        },
    })

    return {
        razorpay_order_id: order.id,
        amount_inr_paise:  pack.amount_inr_paise,
        credits_to_award:  pack.credits + pack.bonus_credits,
        key_id:            process.env.RAZORPAY_KEY_ID ?? "",
        pack,
        plan: null,
    }
}

/**
 * Verifies the Razorpay payment signature and applies credits.
 */
export async function verifyRazorpayPayment(
    userId:              string,
    razorpay_order_id:   string,
    razorpay_payment_id: string,
    razorpay_signature:  string,
): Promise<{ credits_awarded: number; new_balance: number; plan?: Plan | null }> {
    userId = await resolveBillingUserId(userId)
    const keySecret = process.env.RAZORPAY_KEY_SECRET
    if (!keySecret) throw new Error("RAZORPAY_KEY_SECRET is not configured")

    const body = `${razorpay_order_id}|${razorpay_payment_id}`
    const expected = crypto.createHmac("sha256", keySecret).update(body).digest("hex")

    if (expected !== razorpay_signature) {
        throw new Error("Invalid Razorpay payment signature")
    }

    const order = await prisma.razorpayOrder.findFirst({
        where: {
            razorpay_order_id,
            user_id: userId,
        },
    })

    if (!order) throw new Error("Order not found")

    if (order.status === "PAID") {
        const balance = await prisma.user.findUnique({ where: { id: userId }, select: { credits_balance: true } })
        return { credits_awarded: 0, new_balance: balance?.credits_balance ?? 0, plan: getPlanFromOrder(order) }
    }

    return markOrderPaidAndApplyBenefits(order, razorpay_payment_id, "verify")
}

export async function processPaidRazorpayOrderFromWebhook(razorpayOrderId: string, razorpayPaymentId: string) {
    const order = await prisma.razorpayOrder.findUnique({
        where: { razorpay_order_id: razorpayOrderId },
    })

    if (!order) return { status: "unknown_order" as const }
    if (order.status === "PAID") return { status: "already_processed" as const, order_id: razorpayOrderId }

    const result = await markOrderPaidAndApplyBenefits(order, razorpayPaymentId, "webhook")
    return { status: "success" as const, ...result }
}
