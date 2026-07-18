import axios from "axios"
import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { hasRunnableBrandPreference } from "../brand_preferences/brand_preferences_service"
import { spendCredits, refundCredits } from "../credits/credits_service"
import { assertProjectAccess } from "../projects/project_access"
import { CREDIT_COSTS } from "../subscription/plan_config"
import {
    createPendingRun,
    listRedditIntelligence,
    markRedditRunFailed,
    markRedditRunRefunded,
    persistRedditScanResult,
} from "./reddit_intelligence_service"
import type { AgentsRedditScanResponse, RedditScanMode } from "./reddit_intelligence_types"

const AGENTS_API_BASE_URL = (
    process.env.AI_REPORTS_API_BASE_URL ??
    process.env.AGENTS_BASE_URL ??
    "http://localhost:8080"
).replace(/\/$/, "")

const agentsApi = axios.create({
    baseURL: AGENTS_API_BASE_URL,
    timeout: Number(process.env.REDDIT_INTELLIGENCE_TIMEOUT_MS ?? 360000),
})

const MODE_CONFIG: Record<RedditScanMode, { credits: number; postLimit: number }> = {
    standard: { credits: CREDIT_COSTS.reddit_intelligence_standard, postLimit: 25 },
    deep: { credits: CREDIT_COSTS.reddit_intelligence_deep, postLimit: 100 },
}

export async function listRedditIntelligenceController(req: Request, res: Response) {
    try {
        const projectId = readString(req.query.project_id)
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }
        const userId = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(projectId, userId)
        res.json(await listRedditIntelligence(projectId, userId))
    } catch (error) {
        handleRedditError(error, res, "Failed to load Reddit Intelligence")
    }
}

export async function runRedditIntelligenceController(req: Request, res: Response) {
    const userId = (req as AuthenticatedRequest).user.id
    let runId: string | null = null
    let idempotencyKey: string | null = null

    try {
        const projectId = readString(req.body?.project_id)
        const mode = normalizeMode(req.body?.mode)
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }
        await assertProjectAccess(projectId, userId)
        const hasPreferences = await hasRunnableBrandPreference(projectId, userId)
        if (!hasPreferences) {
            res.status(428).json({
                error: "Brand preferences are required before running Reddit Intelligence.",
                code: "BRAND_PREFERENCES_REQUIRED",
            })
            return
        }

        const config = MODE_CONFIG[mode]
        idempotencyKey = readIdempotencyKey(req) ?? `reddit-intelligence:${userId}:${projectId}:${mode}:${Date.now()}`

        await spendCredits({
            userId,
            amount: config.credits,
            action: mode === "deep" ? "reddit_intelligence_deep" : "reddit_intelligence_standard",
            description: mode === "deep" ? "Reddit Intelligence deep scan" : "Reddit Intelligence standard scan",
            idempotencyKey,
            metadata: { project_id: projectId, mode },
        })

        const run = await createPendingRun({
            projectId,
            userId,
            mode,
            credits: config.credits,
            postLimit: config.postLimit,
        })
        runId = run.id

        try {
            const response = await agentsApi.post<AgentsRedditScanResponse>("/reddit-intelligence/run", {
                project_id: projectId,
                mode,
                run_id: run.id,
            }, {
                headers: forwardAuth(req),
            })

            let persistedRun = await persistRedditScanResult({
                runId: run.id,
                projectId,
                userId,
                result: response.data,
            })
            if (response.data.status === "FAILED") {
                const reason = response.data.errors[0] ?? "No relevant Reddit discussions found"
                await refundCredits({
                    userId,
                    amount: config.credits,
                    action: "credit_refund",
                    description: "Refund for Reddit Intelligence scan with no relevant posts",
                    idempotencyKey: `refund:${idempotencyKey}`,
                    metadata: { project_id: projectId, mode, reason },
                })
                persistedRun = await markRedditRunRefunded(run.id, reason)
            }

            res.status(200).json({
                run: persistedRun,
                result: response.data,
                intelligence: await listRedditIntelligence(projectId, userId),
            })
        } catch (error) {
            const reason = describeAgentsError(error)
            await refundCredits({
                userId,
                amount: config.credits,
                action: "credit_refund",
                description: "Refund for failed Reddit Intelligence scan",
                idempotencyKey: `refund:${idempotencyKey}`,
                metadata: { project_id: projectId, mode },
            })
            if (runId) {
                await markRedditRunFailed(runId, reason)
            }
            throw error
        }
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("Not enough credits")) {
            res.status(402).json({ error: error.message })
            return
        }
        handleRedditError(error, res, "Failed to run Reddit Intelligence")
    }
}

function normalizeMode(value: unknown): RedditScanMode {
    return value === "deep" ? "deep" : "standard"
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

function handleRedditError(error: unknown, res: Response, fallback: string) {
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
        res.status(404).json({ error: "Project not found" })
        return
    }

    if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 502
        const data = error.response?.data
        res.status(status).json(typeof data === "object" && data !== null ? data : { error: fallback })
        return
    }

    console.error("[reddit-intelligence] Error:", error)
    res.status(500).json({ error: fallback })
}

function describeAgentsError(error: unknown) {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data
        if (typeof data === "object" && data !== null) {
            const errorMessage = "error" in data && typeof data.error === "string" ? data.error : null
            const detail = "detail" in data && typeof data.detail === "string" ? data.detail : null
            const errors = "errors" in data && Array.isArray(data.errors)
                ? data.errors.filter((item: unknown): item is string => typeof item === "string")
                : []
            return (errorMessage ?? detail ?? errors[0] ?? error.message).slice(0, 1000)
        }
        return error.message.slice(0, 1000)
    }
    return error instanceof Error ? error.message.slice(0, 1000) : "Reddit Intelligence failed"
}
