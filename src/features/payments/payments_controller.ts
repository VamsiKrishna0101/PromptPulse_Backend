import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import crypto from "crypto"
import { Plan } from "@prisma/client"
import { getRazorpayClient } from "./razorpay_config"
import { createRazorpayOrder, verifyRazorpayPayment } from "./razorpay_service"
import { handleRazorpayWebhook } from "./razorpay_webhook_service"
import { getCreditBalance, getCreditTransactions, isLowBalance } from "./credits_service"
import { AGENCY_CREDIT_PACKS, CREDIT_PACKS } from "./credits_config"
import { publicBillingCatalog } from "./billing_catalog"
import {
    createRazorpaySubscription,
    getBillingAudience,
    grantDueAnnualSubscriptionCreditsForUser,
    verifyRazorpaySubscription,
} from "./razorpay_subscription_service"

/** GET /api/payments/balance */
export async function getBalanceController(req: Request, res: Response): Promise<void> {
    const { user: { id: userId } } = req as AuthenticatedRequest
    await grantDueAnnualSubscriptionCreditsForUser(userId)
    const balance = await getCreditBalance(userId)
    const lowBalance = await isLowBalance(userId)
    res.json({ credits_balance: balance, low_balance: lowBalance })
}

/** GET /api/payments/packs */
export async function getCreditPacksController(req: Request, res: Response): Promise<void> {
    const { user: { id: userId } } = req as AuthenticatedRequest
    const audience = await getBillingAudience(userId)
    res.json({
        packs: audience === "AGENCY" ? AGENCY_CREDIT_PACKS : CREDIT_PACKS,
        account_type: audience,
    })
}

export async function getBillingCatalogController(req: Request, res: Response): Promise<void> {
    const { user: { id: userId } } = req as AuthenticatedRequest
    const audience = await getBillingAudience(userId)
    res.json(publicBillingCatalog(audience))
}

export async function createSubscriptionController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const { plan_id, billing_interval } = req.body
        const result = await createRazorpaySubscription({ userId, plan: plan_id, billingInterval: billing_interval })
        res.status(201).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create subscription"
        const status = message.includes("Invalid") || message.includes("already exists") || message.includes("Agency accounts") ? 400 : 500
        res.status(status).json({ error: message })
    }
}

export async function verifySubscriptionController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body
        if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
            res.status(400).json({ error: "razorpay_payment_id, razorpay_subscription_id, and razorpay_signature are required" })
            return
        }
        res.json(await verifyRazorpaySubscription({
            userId,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySubscriptionId: razorpay_subscription_id,
            razorpaySignature: razorpay_signature,
        }))
    } catch (error) {
        const message = error instanceof Error ? error.message : "Subscription verification failed"
        res.status(message.includes("Invalid") || message.includes("not found") ? 400 : 500).json({ error: message })
    }
}

/** GET /api/payments/transactions */
export async function getTransactionsController(req: Request, res: Response): Promise<void> {
    const { user: { id: userId } } = req as AuthenticatedRequest
    const page  = Number(req.query.page)  || 1
    const limit = Number(req.query.limit) || 20
    const days = req.query.days ? Number(req.query.days) : undefined
    const type = req.query.type === "credit" || req.query.type === "debit" ? req.query.type : "all"
    const result = await getCreditTransactions(userId, page, limit, { days, type })
    res.json(result)
}

/** POST /api/payments/razorpay/create-order */
export async function createOrderController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const { pack_id, custom_credits, plan_id } = req.body as { pack_id?: string; custom_credits?: number; plan_id?: Plan }

        if (!pack_id && custom_credits === undefined && !plan_id) {
            res.status(400).json({ error: "pack_id, custom_credits, or plan_id is required" })
            return
        }

        const order = await createRazorpayOrder(userId, pack_id, custom_credits, plan_id)
        res.status(201).json(order)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create order"
        const status  = message === "Invalid credit pack" || message === "Invalid credit plan" ? 400 : 500
        res.status(status).json({ error: message })
    }
}

/** POST /api/create-order */
export async function createStandardOrderController(req: Request, res: Response): Promise<void> {
    try {
        const {
            amount,
            currency = "INR",
            receipt,
        } = req.body as {
            amount?: number
            currency?: string
            receipt?: string
        }

        if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 100) {
            res.status(400).json({ error: "amount must be an integer of at least 100 paise" })
            return
        }

        const razorpay = getRazorpayClient()
        const order = await (razorpay.orders as any).create({
            amount,
            currency,
            receipt: receipt ?? `receipt_${Date.now()}`,
        })

        res.status(201).json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
        })
    } catch (error) {
        console.error("Failed to create Razorpay standard order", error)
        res.status(500).json({ error: "Failed to create order" })
    }
}

/** POST /api/payments/razorpay/verify */
export async function verifyPaymentController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
        } = req.body as {
            razorpay_order_id?:   string
            razorpay_payment_id?: string
            razorpay_signature?:  string
        }

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            res.status(400).json({ error: "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required" })
            return
        }

        const result = await verifyRazorpayPayment(userId, razorpay_order_id, razorpay_payment_id, razorpay_signature)
        res.json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Payment verification failed"
        const status  = message.includes("Invalid") || message.includes("not found") ? 400 : 500
        res.status(status).json({ error: message })
    }
}

/** POST /api/verify-payment */
export async function verifyStandardPaymentController(req: Request, res: Response): Promise<void> {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            order_id,
            payment_id,
            signature,
        } = req.body as {
            razorpay_order_id?: string
            razorpay_payment_id?: string
            razorpay_signature?: string
            order_id?: string
            payment_id?: string
            signature?: string
        }

        const resolvedOrderId = razorpay_order_id ?? order_id
        const resolvedPaymentId = razorpay_payment_id ?? payment_id
        const resolvedSignature = razorpay_signature ?? signature

        if (!resolvedOrderId || !resolvedPaymentId || !resolvedSignature) {
            res.status(400).json({ error: "razorpay_order_id, razorpay_payment_id, and razorpay_signature are required" })
            return
        }

        const keySecret = process.env.RAZORPAY_KEY_SECRET
        if (!keySecret) throw new Error("RAZORPAY_KEY_SECRET is not configured")

        const body = `${resolvedOrderId}|${resolvedPaymentId}`
        const expected = crypto.createHmac("sha256", keySecret).update(body).digest("hex")

        const expectedBuffer = Buffer.from(expected)
        const receivedBuffer = Buffer.from(resolvedSignature)
        const isValid = expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer)

        if (!isValid) {
            res.status(400).json({ success: false, error: "Invalid Razorpay payment signature" })
            return
        }

        res.json({ success: true })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Payment verification failed"
        res.status(500).json({ success: false, error: message })
    }
}

/** POST /api/payments/razorpay/webhook (raw body, no auth middleware) */
export async function razorpayWebhookController(req: Request, res: Response): Promise<void> {
    try {
        const signature = req.headers["x-razorpay-signature"] as string
        const result = await handleRazorpayWebhook(req.body as Buffer, signature)
        res.status(200).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Webhook error"
        const status  = message.includes("signature") ? 400 : 500
        res.status(status).json({ error: message })
    }
}

/**
 * GET /api/payments/razorpay/check-subscription?subscription_id=xxx
 * Polls Razorpay to check if a subscription's first payment was collected.
 * Used by the frontend after the UPI QR modal closes — identical in purpose
 * to check-order but for subscriptions which don't have an order_id.
 */
export async function checkSubscriptionStatusController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const subscriptionId = req.query.subscription_id as string
        if (!subscriptionId) {
            res.status(400).json({ error: "subscription_id is required" })
            return
        }

        const razorpay = getRazorpayClient()
        const remote = await (razorpay.subscriptions as any).fetch(subscriptionId) as {
            id: string
            status: string
            paid_count?: number
            notes?: Record<string, string>
        }

        if (!remote || remote.id !== subscriptionId) {
            res.status(404).json({ error: "Subscription not found" })
            return
        }

        const billingUserId = await (await import("./credits_service")).resolveBillingUserId(userId)
        const activeStatuses = ["active", "authenticated"]
        const isActive = activeStatuses.includes(remote.status)
        const paidCount = remote.paid_count ?? 0

        // Determine what plan this subscription is for
        const subscription = await prisma.subscription.findFirst({
            where: {
                user_id: billingUserId,
                razorpay_subscription_id: subscriptionId,
            },
            select: { id: true, plan: true },
        })

        // Check if we already credited this user for this subscription period.
        // grantSubscriptionCredits stores the DB subscription UUID (not the Razorpay sub ID)
        const existing = subscription ? await prisma.creditTransaction.findFirst({
            where: {
                user_id: billingUserId,
                metadata: { path: ["subscription_id"], equals: subscription.id },
            },
        }) : null

        res.json({
            active: isActive,
            status: remote.status,
            paid_count: paidCount,
            already_credited: !!existing,
            plan: subscription?.plan ?? null,
        })
    } catch (error) {
        console.error("[checkSubscriptionStatus] error:", error)
        const message = error instanceof Error ? error.message : "Failed to check subscription"
        res.status(500).json({ error: message })
    }
}

/**
 * GET /api/payments/razorpay/check-order?order_id=xxx
 * Polls Razorpay to check if a given order was paid.
 * Used by the frontend after the UPI QR modal closes so we can detect
 * payments that completed on the user's phone without triggering the
 * JS handler callback.
 */
export async function checkOrderStatusController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const orderId = req.query.order_id as string
        if (!orderId || typeof orderId !== "string") {
            res.status(400).json({ error: "order_id is required" })
            return
        }

        const razorpay = getRazorpayClient()
        const order = await (razorpay.orders as any).fetch(orderId) as {
            id: string
            status: string
            amount: number
            receipt?: string
        }

        if (!order || order.id !== orderId) {
            res.status(404).json({ error: "Order not found" })
            return
        }

        // "paid" is the only terminal success state in Razorpay orders
        if (order.status !== "paid") {
            res.json({ paid: false, status: order.status })
            return
        }

        // Order is paid — check if we already processed it by looking at credit transactions
        const existing = await prisma.creditTransaction.findFirst({
            where: {
                user_id: userId,
                metadata: { path: ["razorpay_order_id"], equals: orderId },
            },
        })

        res.json({ paid: true, status: order.status, already_credited: !!existing })
    } catch (error) {
        console.error("[checkOrderStatus] error:", error)
        const message = error instanceof Error ? error.message : "Failed to check order"
        res.status(500).json({ error: message })
    }
}

/**
 * POST /api/payments/razorpay/cancel-subscription
 * Cancels the user's active/stuck subscription on Razorpay and marks it CANCELED locally.
 * Allows the user to subscribe to a new plan immediately after.
 */
export async function cancelSubscriptionController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const billingUserId = await (await import("./credits_service")).resolveBillingUserId(userId)

        const subscription = await prisma.subscription.findFirst({
            where: {
                user_id: billingUserId,
                razorpay_subscription_id: { not: null },
                status: { in: ["ACTIVE", "PAST_DUE", "INCOMPLETE"] },
            },
            orderBy: { created_at: "desc" },
        })

        if (!subscription) {
            res.status(404).json({ error: "No active subscription found" })
            return
        }

        // Cancel on Razorpay (cancel_at_cycle_end: false = immediate)
        if (subscription.razorpay_subscription_id) {
            try {
                const razorpay = getRazorpayClient()
                await (razorpay.subscriptions as any).cancel(subscription.razorpay_subscription_id, { cancel_at_cycle_end: false })
            } catch (err) {
                // If already cancelled on Razorpay side, continue with local cleanup
                const msg = err instanceof Error ? err.message : ""
                if (!msg.includes("already cancelled") && !msg.includes("BAD_REQUEST")) {
                    throw err
                }
            }
        }

        await prisma.subscription.update({
            where: { id: subscription.id },
            data: { status: "CANCELED", cancel_at_period_end: true },
        })

        res.json({ cancelled: true, subscription_id: subscription.id })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to cancel subscription"
        res.status(500).json({ error: message })
    }
}
