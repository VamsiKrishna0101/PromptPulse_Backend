import axios from "axios"
import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { assertProjectAccess } from "../projects/project_access"
import {
    listActionQueueItems,
    normalizeActionStatus,
    updateActionQueueItemStatus,
} from "./action_queue_service"

const AGENTS_API_BASE_URL = (
    process.env.AI_REPORTS_API_BASE_URL ??
    process.env.AGENTS_BASE_URL ??
    "http://localhost:8080"
).replace(/\/$/, "")

const agentsApi = axios.create({
    baseURL: AGENTS_API_BASE_URL,
    timeout: 120_000,
})

export async function listActionQueueController(req: Request, res: Response) {
    try {
        const projectId = readString(req.query.project_id)
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        const userId = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(projectId, userId)

        const items = await listActionQueueItems({
            projectId,
            userId,
            status: readString(req.query.status),
            category: readString(req.query.category),
        })

        res.json(items)
    } catch (error) {
        handleActionQueueError(error, res, "Failed to load action queue")
    }
}

export async function generateActionQueueController(req: Request, res: Response) {
    try {
        const projectId = readString(req.body?.project_id)
        const lookbackDays = readPositiveNumber(req.body?.lookback_days) ?? 30
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        const userId = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(projectId, userId)

        const response = await agentsApi.post("/action-queue/generate", {
            project_id: projectId,
            lookback_days: lookbackDays,
        }, {
            headers: forwardAuth(req),
        })

        res.status(response.status).json(response.data)
    } catch (error) {
        handleActionQueueError(error, res, "Failed to refresh action queue")
    }
}

export async function updateActionQueueController(req: Request, res: Response) {
    try {
        const itemId = readString(req.params.item_id)
        const status = normalizeActionStatus(req.body?.status)
        if (!itemId) {
            res.status(400).json({ error: "item_id is required" })
            return
        }
        if (!status) {
            res.status(400).json({ error: "A valid status is required" })
            return
        }

        const item = await updateActionQueueItemStatus({
            itemId,
            userId: (req as AuthenticatedRequest).user.id,
            status,
        })

        res.json(item)
    } catch (error) {
        handleActionQueueError(error, res, "Failed to update action")
    }
}

function forwardAuth(req: Request) {
    const authorization = req.header("authorization")
    return authorization ? { Authorization: authorization } : undefined
}

function readString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readPositiveNumber(value: unknown) {
    const numeric = typeof value === "number" ? value : Number(value)
    return Number.isFinite(numeric) && numeric > 0 ? Math.min(Math.round(numeric), 90) : undefined
}

function handleActionQueueError(error: unknown, res: Response, fallback: string) {
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
        res.status(404).json({ error: "Project not found" })
        return
    }
    if (error instanceof Error && error.message === "ACTION_QUEUE_ITEM_NOT_FOUND") {
        res.status(404).json({ error: "Action not found" })
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

    console.error("[action queue] Error:", error)
    res.status(500).json({ error: fallback })
}
