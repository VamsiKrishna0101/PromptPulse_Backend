import { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { assertProjectAccess } from "../projects/project_access"
import { createCsvExport, createExcelExport, createPdfExport, createGeoArticlePdf } from "./export_service"
import type { ExportFilters, ExportResource } from "./export_types"

const EXPORT_RESOURCES = new Set<ExportResource>([
    "overview",
    "prompts",
    "chats",
    "sources",
    "competitors",
    "web-analytics",
])

export async function downloadCsvExportController(req: Request, res: Response): Promise<void> {
    try {
        const project_id = getProjectId(req, res)
        if (!project_id) return

        const resource = getResource(req, res)
        if (!resource) return

        const format = getFormat(req)
        const filters = parseFilters(req.query)

        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)

        // ── PDF ───────────────────────────────────────────────────────────────
        if (format === "pdf") {
            const result = await createPdfExport({ project_id, resource, filters })
            res.setHeader("Content-Type", "application/pdf")
            res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`)
            res.status(200).send(result.content)
            return
        }

        // ── Excel (.xlsx) — the default "CSV" export ──────────────────────────
        if (format === "xlsx" || format === "csv") {
            const result = await createExcelExport({ project_id, resource, filters })
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`)
            res.status(200).send(result.content)
            return
        }

        res.status(400).json({ error: "Unsupported format" })
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }
        console.error("Export failed", error)
        res.status(500).json({ error: "Export failed" })
    }
}

export async function exportGeoArticlePdfController(req: Request, res: Response) {
    try {
        const project_id = req.params.project_id
        if (!project_id) {
            res.status(400).json({ error: "Missing project_id" })
            return
        }

        const { brief, article } = req.body
        if (!brief || !article) {
            res.status(400).json({ error: "Missing brief or article in request body" })
            return
        }

        const pdf = await createGeoArticlePdf({ project_id, brief, article })

        res.setHeader("Content-Type", "application/pdf")
        res.setHeader("Content-Disposition", `attachment; filename="${pdf.filename}"`)
        res.send(pdf.content)
    } catch (error) {
        console.error("[exportGeoArticlePdfController] Error:", error)
        res.status(500).json({ error: "Failed to generate GEO article PDF" })
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

function getResource(req: Request, res: Response): ExportResource | null {
    const rawResource = req.params.resource?.replace(/\.(csv|pdf|xlsx)$/i, "")
    if (!rawResource || !EXPORT_RESOURCES.has(rawResource as ExportResource)) {
        res.status(400).json({ error: "Unsupported export resource" })
        return null
    }
    return rawResource as ExportResource
}

function getFormat(req: Request): "csv" | "pdf" | "xlsx" {
    const ext = req.params.resource?.split(".").pop()?.toLowerCase()
    if (ext === "pdf") return "pdf"
    if (ext === "xlsx") return "xlsx"
    return "csv"   // .csv → still routed to xlsx for better quality
}

function parseFilters(query: Request["query"]): ExportFilters {
    return {
        days: parsePositiveInt(query.days),
        model: parseString(query.model),
        topic: parseString(query.topic),
        status: parseString(query.status),
        q: parseString(query.q),
    }
}

function parseString(value: unknown) {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    if (!trimmed || trimmed === "all") return undefined
    return trimmed
}

function parsePositiveInt(value: unknown) {
    if (typeof value !== "string") return undefined
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined
    return parsed
}
