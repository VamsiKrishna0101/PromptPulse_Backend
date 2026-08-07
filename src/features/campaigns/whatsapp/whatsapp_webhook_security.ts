import { createHmac, timingSafeEqual } from "node:crypto"
import type { Request } from "express"

export function verifyMetaWebhookSignature(req: Request): boolean {
    const appSecret = process.env.META_APP_SECRET?.trim()
    if (!appSecret) return process.env.NODE_ENV !== "production"

    const signature = req.header("x-hub-signature-256")
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody
    if (!signature || !rawBody) return false

    const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`
    const expectedBuffer = Buffer.from(expected)
    const actualBuffer = Buffer.from(signature)
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
}
