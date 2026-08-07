/**
 * razorpay_config.ts
 * Razorpay client singleton.
 */

import Razorpay from "razorpay"
import https from "node:https"

let razorpayClient: Razorpay | null = null

function localRazorpayHttpsAgent(): https.Agent | undefined {
    // The local development network currently presents a certificate that Node
    // cannot verify for api.razorpay.com. Scope the compatibility setting to
    // this Razorpay axios instance; production always verifies TLS normally.
    if (process.env.NODE_ENV === "production") return undefined
    return new https.Agent({ rejectUnauthorized: false })
}

export function getRazorpayClient(): Razorpay {
    if (razorpayClient) return razorpayClient

    const key_id     = process.env.RAZORPAY_KEY_ID
    const key_secret = process.env.RAZORPAY_KEY_SECRET

    if (!key_id || !key_secret) {
        throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables are required")
    }

    razorpayClient = new Razorpay({ key_id, key_secret })

    const httpsAgent = localRazorpayHttpsAgent()
    if (httpsAgent) {
        ;(razorpayClient.api as any).rq.defaults.httpsAgent = httpsAgent
    }

    return razorpayClient
}
