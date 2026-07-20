import type { Request, Response, NextFunction } from "express"

const WINDOW_MS = 10 * 60 * 1000
const MAX_REQUESTS = 30
const buckets = new Map<string, { count: number; reset_at: number }>()

export function landingChatRateLimit(req: Request, res: Response, next: NextFunction) {
    const key = req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown"
    const now = Date.now()
    const bucket = buckets.get(key)

    if (!bucket || bucket.reset_at <= now) {
        buckets.set(key, { count: 1, reset_at: now + WINDOW_MS })
        next()
        return
    }

    bucket.count += 1
    if (bucket.count > MAX_REQUESTS) {
        res.status(429).json({
            error: "Too many questions right now. Please try again in a few minutes.",
        })
        return
    }

    next()
}
