import { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import prisma from "../lib/prisma"

export type AuthenticatedRequest = Request & {
    user: {
        id: string
        role?: "USER" | "ADMIN"
    }
}

type AccessTokenPayload = {
    sub?: string
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers.authorization

    if (!header?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing authorization token" })
        return
    }

    try {
        const token = header.slice("Bearer ".length).trim()
        const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AccessTokenPayload

        if (!payload.sub) {
            res.status(401).json({ error: "Invalid authorization token" })
            return
        }

        ;(req as AuthenticatedRequest).user = { id: payload.sub }
        next()
    } catch {
        res.status(401).json({ error: "Invalid or expired authorization token" })
    }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const userId = (req as AuthenticatedRequest).user?.id
        if (!userId) {
            res.status(401).json({ error: "Authentication required" })
            return
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true }
        })

        if (!user) {
            res.status(401).json({ error: "Invalid user" })
            return
        }

        if (user.role !== "ADMIN") {
            res.status(403).json({ error: "Admin access required" })
            return
        }

        ;(req as AuthenticatedRequest).user = { id: user.id, role: user.role }
        next()
    } catch {
        res.status(500).json({ error: "Failed to verify admin access" })
    }
}
