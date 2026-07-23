import { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { assertProjectAccess } from "../projects/project_access"
import {
    chatWithSara,
    chatWithSaraStream,
    getSaraConversations,
    getSaraMessages,
    getSaraReadiness,
    reindexSaraProject,
    searchSaraProject
} from "./sara_service"

export async function reindexSaraProjectController(req: Request, res: Response): Promise<void> {
    try {
        const project_id = getProjectId(req, res)
        if (!project_id) return

        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
        const result = await reindexSaraProject(project_id, {
            chat_limit: readOptionalLimit(req.body.chat_limit),
            source_limit: readOptionalLimit(req.body.source_limit)
        })
        res.status(200).json(result)
    } catch (error) {
        handleSaraError(error, res, "Failed to reindex Sara knowledge")
    }
}

export async function searchSaraProjectController(req: Request, res: Response): Promise<void> {
    try {
        const project_id = getProjectId(req, res)
        if (!project_id) return

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)

        const query = typeof req.body.query === "string" ? req.body.query.trim() : ""
        if (!query) {
            res.status(400).json({ error: "query is required" })
            return
        }

        const limit = typeof req.body.limit === "number" ? req.body.limit : undefined
        const document_types = Array.isArray(req.body.document_types)
            ? req.body.document_types.filter((item: unknown): item is string => typeof item === "string")
            : undefined

        const results = await searchSaraProject({
            user_id,
            project_id,
            query,
            limit,
            document_types
        })

        res.status(200).json({ results })
    } catch (error) {
        handleSaraError(error, res, "Failed to search Sara knowledge")
    }
}

export async function chatWithSaraController(req: Request, res: Response): Promise<void> {
    try {
        const project_id = getProjectId(req, res)
        if (!project_id) return

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)

        const message = typeof req.body.message === "string" ? req.body.message.trim() : ""
        if (!message) {
            res.status(400).json({ error: "message is required" })
            return
        }

        const result = await chatWithSara({
            user_id,
            project_id,
            message,
            conversation_id: typeof req.body.conversation_id === "string" ? req.body.conversation_id : undefined,
            page_context: typeof req.body.page_context === "string" ? req.body.page_context : undefined,
            limit: typeof req.body.limit === "number" ? req.body.limit : undefined
        })

        res.status(200).json(result)
    } catch (error) {
        handleSaraError(error, res, "Failed to chat with Sara")
    }
}

export async function chatWithSaraStreamController(req: Request, res: Response): Promise<void> {
    try {
        const project_id = getProjectId(req, res)
        if (!project_id) return

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)

        const message = typeof req.body.message === "string" ? req.body.message.trim() : ""
        if (!message) {
            res.status(400).json({ error: "message is required" })
            return
        }

        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        })

        const result = await chatWithSaraStream({
            user_id,
            project_id,
            message,
            conversation_id: typeof req.body.conversation_id === "string" ? req.body.conversation_id : undefined,
            page_context: typeof req.body.page_context === "string" ? req.body.page_context : undefined,
            limit: typeof req.body.limit === "number" ? req.body.limit : undefined,
            onReady: (payload) => writeSaraEvent(res, "ready", payload),
            onToken: (token) => writeSaraEvent(res, "token", { token })
        })

        writeSaraEvent(res, "done", {
            conversation_id: result.conversation_id,
            message_id: result.message_id,
            citations: result.citations,
            suggested_actions: result.suggested_actions,
            confidence: result.confidence,
            debug: result.debug
        })
        res.end()
    } catch (error) {
        if (res.headersSent) {
            writeSaraEvent(res, "error", serializeSaraStreamError(error, "Failed to chat with Sara"))
            res.end()
            return
        }

        handleSaraError(error, res, "Failed to chat with Sara")
    }
}

export async function getSaraReadinessController(req: Request, res: Response): Promise<void> {
    try {
        const project_id = getProjectId(req, res)
        if (!project_id) return

        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
        res.status(200).json(await getSaraReadiness(project_id))
    } catch (error) {
        handleSaraError(error, res, "Failed to check Sara readiness")
    }
}

export async function getSaraConversationsController(req: Request, res: Response): Promise<void> {
    try {
        const project_id = getProjectId(req, res)
        if (!project_id) return

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)
        res.status(200).json(await getSaraConversations({ user_id, project_id }))
    } catch (error) {
        handleSaraError(error, res, "Failed to load Sara conversations")
    }
}

export async function getSaraMessagesController(req: Request, res: Response): Promise<void> {
    try {
        const project_id = getProjectId(req, res)
        if (!project_id) return

        const { conversation_id } = req.params
        if (!conversation_id || Array.isArray(conversation_id)) {
            res.status(400).json({ error: "conversation_id is required" })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)
        res.status(200).json(await getSaraMessages({ user_id, project_id, conversation_id }))
    } catch (error) {
        handleSaraError(error, res, "Failed to load Sara messages")
    }
}

function getProjectId(req: Request, res: Response) {
    const { project_id } = req.params
    if (!project_id || Array.isArray(project_id)) {
        res.status(400).json({ error: "project_id is required" })
        return null
    }
    return project_id
}

function handleSaraError(error: unknown, res: Response, fallback: string) {
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
        res.status(404).json({ error: "Project not found" })
        return
    }

    if (error instanceof Error && error.message === "SARA_CONVERSATION_NOT_FOUND") {
        res.status(404).json({ error: "Sara conversation not found" })
        return
    }

    if (error instanceof Error && error.message === "SARA_NOT_READY") {
        res.status(409).json({
            error: "Sara needs at least 1 day of project data before chatting",
            details: (error as Error & { details?: unknown }).details
        })
        return
    }


    console.error(fallback, error)
    res.status(500).json({ error: fallback })
}

function writeSaraEvent(res: Response, event: string, payload: unknown) {
    res.write(`event: ${event}\n`)
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function serializeSaraStreamError(error: unknown, fallback: string) {
    if (error instanceof Error && error.message === "SARA_NOT_READY") {
        return {
            error: "Sara needs at least 1 day of project data before chatting",
            details: (error as Error & { details?: unknown }).details
        }
    }

    if (error instanceof Error && error.message === "SARA_CONVERSATION_NOT_FOUND") {
        return { error: "Sara conversation not found" }
    }


    console.error(fallback, error)
    return { error: fallback }
}

function readOptionalLimit(value: unknown) {
    if (typeof value !== "number") return undefined
    if (!Number.isFinite(value)) return undefined
    return Math.max(0, Math.floor(value))
}
