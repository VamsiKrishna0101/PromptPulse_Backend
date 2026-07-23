/**
 * razorpay_webhook_service.ts
 * Handles Razorpay webhooks for server-side payment confirmation.
 */

import crypto from "crypto"
import { processPaidRazorpayOrderFromWebhook } from "./razorpay_service"

interface RazorpayWebhookPayload {
    event: string
    payload?: {
        payment?: {
            entity?: {
                id: string
                order_id: string
                status: string
                amount: number
                currency: string
            }
        }
    }
}

function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET
    if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET is not configured")
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
    return expected === signature
}

export async function handleRazorpayWebhook(rawBody: Buffer, signature: string) {
    if (!verifyWebhookSignature(rawBody, signature)) {
        throw new Error("Invalid Razorpay webhook signature")
    }

    const event = JSON.parse(rawBody.toString()) as RazorpayWebhookPayload
    if (event.event !== "payment.captured") {
        return { status: "ignored", event: event.event }
    }

    const entity = event.payload?.payment?.entity
    if (!entity) throw new Error("Malformed webhook payload")

    return processPaidRazorpayOrderFromWebhook(entity.order_id, entity.id)
}
