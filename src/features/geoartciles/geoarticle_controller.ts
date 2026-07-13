import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { assertProjectAccess } from "../projects/project_access"
import {
    deleteSavedContentBrief,
    getSavedContentBrief,
    listSavedContentBriefs,
    upsertSavedContentBrief,
} from "./contentbrief_storage"
import { getGeoArticle } from "./geoarticle_service"
import type { SavedGeoArticleItem } from "./geoarticle_types"

function readString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(value: unknown) {
    if (typeof value !== "string") return undefined
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
}

function readBoolean(value: unknown) {
    if (value === "false") return false
    if (value === "true") return true
    return undefined
}

function toSavedGeoArticleItem(row: Awaited<ReturnType<typeof listSavedContentBriefs>>[number]): SavedGeoArticleItem {
    return {
        id: row.id,
        offset: row.opportunity_offset,
        status: row.status,
        brief: row.brief,
        article: row.article,
        generation_error: row.generation_error,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

export async function listSavedGeoArticlesController(req: Request, res: Response): Promise<void> {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)

        const rows = await listSavedContentBriefs({
            project_id,
            user_id,
            topic: readString(req.query.topic),
            limit: readNumber(req.query.limit),
        })

        res.status(200).json({
            items: rows.map(toSavedGeoArticleItem),
            total_saved: rows.length,
        })
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }

        res.status(500).json({ error: "Failed to list saved content briefs" })
    }
}

export async function getSavedGeoArticleController(req: Request, res: Response): Promise<void> {
    try {
        const { project_id, content_brief_id } = req.params
        if (!project_id || !content_brief_id || Array.isArray(project_id) || Array.isArray(content_brief_id)) {
            res.status(400).json({ error: "project_id and content_brief_id are required" })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)

        const row = await getSavedContentBrief({ id: content_brief_id, project_id, user_id })
        if (!row) {
            res.status(404).json({ error: "Saved content brief not found" })
            return
        }

        res.status(200).json(toSavedGeoArticleItem(row))
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }

        res.status(500).json({ error: "Failed to get saved content brief" })
    }
}

export async function deleteSavedGeoArticleController(req: Request, res: Response): Promise<void> {
    try {
        const { project_id, content_brief_id } = req.params
        if (!project_id || !content_brief_id || Array.isArray(project_id) || Array.isArray(content_brief_id)) {
            res.status(400).json({ error: "project_id and content_brief_id are required" })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)

        const deleted = await deleteSavedContentBrief({ id: content_brief_id, project_id, user_id })
        if (!deleted) {
            res.status(404).json({ error: "Saved content brief not found" })
            return
        }

        res.status(204).send()
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }

        res.status(500).json({ error: "Failed to delete saved content brief" })
    }
}

export async function getGeoArticleController(req: Request, res: Response): Promise<void> {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)

        const data = await getGeoArticle({
            project_id,
            days: readNumber(req.query.days),
            topic: readString(req.query.topic),
            prompt_id: readString(req.query.prompt_id),
            model: readString(req.query.model),
            generate: readBoolean(req.query.generate),
            geo_country: readString(req.query.geo_country),
            offset: readNumber(req.query.offset),
        })
        const saved = await upsertSavedContentBrief({ project_id, user_id, response: data })

        res.status(200).json({ ...data, saved_content_brief_id: saved.id })
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }

        if (error instanceof Error && error.message === "NO_GEO_ARTICLE_OPPORTUNITY") {
            res.status(404).json({
                error: "No GEO article opportunity found",
                hint: "Run more prompts or try a wider date range."
            })
            return
        }

        if (error instanceof Error && error.message === "NO_GEO_ARTICLE_EVIDENCE") {
            res.status(404).json({
                error: "No GEO article evidence found",
                hint: "Try without prompt_id or use a wider date range."
            })
            return
        }

        res.status(500).json({ error: "Failed to get GEO article" })
    }
}
