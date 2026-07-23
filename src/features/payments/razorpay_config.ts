/**
 * razorpay_config.ts
 * Razorpay client singleton.
 */

import Razorpay from "razorpay"

let razorpayClient: Razorpay | null = null

export function getRazorpayClient(): Razorpay {
    if (razorpayClient) return razorpayClient

    const key_id     = process.env.RAZORPAY_KEY_ID
    const key_secret = process.env.RAZORPAY_KEY_SECRET

    if (!key_id || !key_secret) {
        throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables are required")
    }

    razorpayClient = new Razorpay({ key_id, key_secret })
    return razorpayClient
}
