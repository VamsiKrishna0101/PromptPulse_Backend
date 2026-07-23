import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import crypto from "crypto"
import { Plan } from "@prisma/client"
import { getRazorpayClient } from "./razorpay_config"
import { createRazorpayOrder, verifyRazorpayPayment } from "./razorpay_service"
import { handleRazorpayWebhook } from "./razorpay_webhook_service"
import { getCreditBalance, getCreditTransactions, isLowBalance } from "./credits_service"
import { CREDIT_PACKS } from "./credits_config"

/** GET /api/payments/balance */
export async function getBalanceController(req: Request, res: Response): Promise<void> {
    const { user: { id: userId } } = req as AuthenticatedRequest
    const balance = await getCreditBalance(userId)
    const lowBalance = await isLowBalance(userId)
    res.json({ credits_balance: balance, low_balance: lowBalance })
}

/** GET /api/payments/packs */
export async function getCreditPacksController(_req: Request, res: Response): Promise<void> {
    res.json({ packs: CREDIT_PACKS })
}

/** GET /api/payments/transactions */
export async function getTransactionsController(req: Request, res: Response): Promise<void> {
    const { user: { id: userId } } = req as AuthenticatedRequest
    const page  = Number(req.query.page)  || 1
    const limit = Number(req.query.limit) || 20
    const result = await getCreditTransactions(userId, page, limit)
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
