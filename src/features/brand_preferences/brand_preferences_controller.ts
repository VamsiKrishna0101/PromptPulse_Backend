import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { getBrandPreference, upsertBrandPreference } from "./brand_preferences_service"

const preferenceSchema = z.object({
    industry_category: z.string().trim().min(2, "Industry/category is required").max(120),
    buyer_persona: z.string().trim().max(200).optional().nullable(),
    keywords: z.array(z.string().trim().min(2).max(80)).min(1, "Add at least one keyword").max(20),
    avoid_keywords: z.array(z.string().trim().min(2).max(80)).max(30).default([]),
    competitor_context: z.string().trim().max(600).optional().nullable(),
    reddit_focus: z.array(z.string().trim().min(2).max(80)).max(12).default([]),
})

export async function getBrandPreferenceController(req: Request, res: Response) {
    try {
        const projectId = readProjectId(req)
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        const userId = (req as AuthenticatedRequest).user.id
        const preference = await getBrandPreference(projectId, userId)
        res.status(200).json({ preference })
    } catch (error) {
        handleBrandPreferenceError(error, res, "Failed to load brand preferences")
    }
}

export async function upsertBrandPreferenceController(req: Request, res: Response) {
    const parsed = preferenceSchema.safeParse({
        ...req.body,
        keywords: normalizeList(req.body?.keywords),
        avoid_keywords: normalizeList(req.body?.avoid_keywords),
        reddit_focus: normalizeList(req.body?.reddit_focus),
    })

    if (!parsed.success) {
        res.status(400).json({
            error: "Please complete the required brand preferences.",
            errors: parsed.error.flatten().fieldErrors,
        })
        return
    }

    try {
        const projectId = readProjectId(req)
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        const userId = (req as AuthenticatedRequest).user.id
        const preference = await upsertBrandPreference(projectId, userId, parsed.data)
        res.status(200).json({ preference })
    } catch (error) {
        handleBrandPreferenceError(error, res, "Failed to save brand preferences")
    }
}

function readProjectId(req: Request) {
    const value = req.params.projectId ?? req.query.project_id
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeList(value: unknown) {
    if (Array.isArray(value)) {
        return cleanList(value)
    }
    if (typeof value === "string") {
        return cleanList(value.split(/[\n,]/g))
    }
    return []
}

function cleanList(values: unknown[]) {
    const seen = new Set<string>()
    const result: string[] = []
    for (const value of values) {
        const item = String(value ?? "").trim()
        const key = item.toLowerCase()
        if (!item || seen.has(key)) continue
        seen.add(key)
        result.push(item)
    }
    return result
}

function handleBrandPreferenceError(error: unknown, res: Response, fallback: string) {
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
        res.status(404).json({ error: "Project not found" })
        return
    }

    console.error("[brand-preferences] Error:", error)
    res.status(500).json({ error: fallback })
}
