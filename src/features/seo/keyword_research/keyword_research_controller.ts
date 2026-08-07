import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../../middleware/auth"
import { toSeoErrorResponse } from "../shared/seo_errors"
import {
    getKeywordResearch,
    listKeywordResearchRuns,
    refreshKeywordResearch,
} from "./keyword_research_service"

const researchSchema = z.object({
    q: z.string().trim().min(1).max(500),
    db: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}$/, "Invalid country database").default("us"),
    type: z.enum(["phrase", "exact", "broad", "related"]).default("phrase"),
    pages: z.coerce.number().int().min(1).max(100).default(1),
})

const listSchema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(12),
})

function projectId(req: Request) {
    const value = req.params.projectId
    return Array.isArray(value) ? value[0] : value
}

function userId(req: Request) {
    return (req as AuthenticatedRequest).user.id
}

function fail(res: Response, error: unknown) {
    const mapped = toSeoErrorResponse(error)
    if (mapped.status >= 500) console.error("[seo.keyword-research] request failed", error)
    res.status(mapped.status).json(mapped.body)
}

async function handleResearch(req: Request, res: Response, refresh: boolean) {
    const parsed = researchSchema.safeParse(req.method === "GET" ? req.query : req.body)
    if (!parsed.success) {
        res.status(400).json({
            error: parsed.error.issues[0]?.message ?? "Invalid keyword research request",
            code: "SEO_VALIDATION_ERROR",
        })
        return
    }
    try {
        const service = refresh ? refreshKeywordResearch : getKeywordResearch
        res.json(await service({
            projectId: projectId(req),
            userId: userId(req),
            query: parsed.data.q,
            database: parsed.data.db,
            matchType: parsed.data.type,
            pages: parsed.data.pages,
        }))
    } catch (error) {
        fail(res, error)
    }
}

export function getKeywordResearchController(req: Request, res: Response) {
    return handleResearch(req, res, false)
}

export function refreshKeywordResearchController(req: Request, res: Response) {
    return handleResearch(req, res, true)
}

export async function listKeywordResearchRunsController(req: Request, res: Response) {
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid run list request", code: "SEO_VALIDATION_ERROR" })
        return
    }
    try {
        res.json(await listKeywordResearchRuns({
            projectId: projectId(req),
            userId: userId(req),
            limit: parsed.data.limit,
        }))
    } catch (error) {
        fail(res, error)
    }
}
