import axios from "axios"
import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import prisma from "../../lib/prisma"
import { spendCredits, refundCredits } from "../credits/credits_service"
import { assertProjectAccess } from "../projects/project_access"
import { CREDIT_COSTS } from "../subscription/plan_config"
import { getEffectivePlanAccess } from "../subscription/entitlements"

const REPORTS_API_BASE_URL = (
    process.env.AI_REPORTS_API_BASE_URL ??
    process.env.AGENTS_BASE_URL ??
    "http://localhost:8080"
).replace(/\/$/, "")

const reportsApi = axios.create({
    baseURL: REPORTS_API_BASE_URL,
    timeout: 120_000,
})

export async function listReportsController(req: Request, res: Response) {
    try {
        const projectId = readString(req.query.project_id)
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        await assertProjectAccess(projectId, (req as AuthenticatedRequest).user.id)
        const response = await reportsApi.get("/reports", {
            params: { project_id: projectId },
            headers: forwardAuth(req),
        })

        res.status(response.status).json(response.data)
    } catch (error) {
        handleReportProxyError(error, res, "Failed to list reports")
    }
}

export async function getReportController(req: Request, res: Response) {
    try {
        const reportId = req.params.report_id
        if (!reportId || Array.isArray(reportId)) {
            res.status(400).json({ error: "report_id is required" })
            return
        }

        const userId = (req as AuthenticatedRequest).user.id
        const report = await prisma.aIReport.findFirst({
            where: { id: reportId, user_id: userId },
            select: { id: true },
        })
        if (!report) {
            res.status(404).json({ error: "Report not found" })
            return
        }

        const response = await reportsApi.get(`/reports/${encodeURIComponent(reportId)}`, {
            headers: forwardAuth(req),
        })

        res.status(response.status).json(response.data)
    } catch (error) {
        handleReportProxyError(error, res, "Failed to get report")
    }
}

export async function generateReportController(req: Request, res: Response) {
    const userId = (req as AuthenticatedRequest).user.id
    let idempotencyKey: string | null = null

    try {
        const projectId = readString(req.body?.project_id)
        const periodType = readString(req.body?.period_type) ?? "7d"
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        await assertProjectAccess(projectId, userId)

        const access = await getEffectivePlanAccess(userId)
        if (access.trial.active) {
            const trialReports = await prisma.aIReport.count({ where: { user_id: userId, created_at: { gte: access.trial.starts_at ?? new Date(0) } } })
            if (trialReports >= 2) {
                res.status(402).json({ error: "Your free trial includes 2 AI reports. Add credits to generate more." })
                return
            }
        }

        idempotencyKey = readIdempotencyKey(req)
            ?? `ai-report:${userId}:${projectId}:${periodType}:${Date.now()}`

        await spendCredits({
            userId,
            amount: CREDIT_COSTS.ai_visibility_report,
            action: "ai_visibility_report",
            description: "AI visibility report generation",
            idempotencyKey,
            metadata: { project_id: projectId, period_type: periodType },
        })

        try {
            const response = await reportsApi.post("/reports/generate", {
                project_id: projectId,
                period_type: periodType,
            }, {
                headers: {
                    ...forwardAuth(req),
                    "Idempotency-Key": idempotencyKey,
                },
            })

            res.status(response.status).json(response.data)
        } catch (error) {
            await refundCredits({
                userId,
                amount: CREDIT_COSTS.ai_visibility_report,
                action: "credit_refund",
                description: "Refund for failed AI visibility report generation",
                idempotencyKey: `refund:${idempotencyKey}`,
                metadata: { project_id: projectId, period_type: periodType },
            })
            throw error
        }
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("Not enough credits")) {
            res.status(402).json({ error: error.message })
            return
        }
        handleReportProxyError(error, res, "Failed to generate report")
    }
}

function forwardAuth(req: Request) {
    const authorization = req.header("authorization")
    return authorization ? { Authorization: authorization } : undefined
}

function readString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readIdempotencyKey(req: Request) {
    const header = req.header("Idempotency-Key")
    if (header?.trim()) return header.trim().slice(0, 180)
    return undefined
}

function handleReportProxyError(error: unknown, res: Response, fallback: string) {
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
        res.status(404).json({ error: "Project not found" })
        return
    }

    if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 502
        const data = error.response?.data
        res.status(status).json(
            typeof data === "object" && data !== null
                ? data
                : { error: fallback },
        )
        return
    }

    console.error("[reports proxy] Error:", error)
    res.status(500).json({ error: fallback })
}
