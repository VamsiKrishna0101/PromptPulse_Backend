import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../../middleware/auth"
import { SiteAuditService } from "./site_audit_service"

function param(value: string | string[] | undefined) {
    return Array.isArray(value) ? value[0] ?? "" : value ?? ""
}

export async function startAuditController(req: Request, res: Response) {
    try {
        const projectId = param(req.params.projectId)
        const parsed = z.object({
            startUrl: z.string().url().max(2048),
            maxPages: z.coerce.number().int().min(1).max(1000).default(100),
        }).safeParse(req.body)
        if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        const userId = (req as AuthenticatedRequest).user.id

        const result = await SiteAuditService.startAudit(projectId, userId, parsed.data.startUrl, parsed.data.maxPages)
        return res.json(result)
    } catch (error: any) {
        return res.status(400).json({ error: error.message })
    }
}

export async function getAuditStatusController(req: Request, res: Response) {
    try {
        const projectId = param(req.params.projectId)
        const auditId = param(req.params.auditId)
        const status = await SiteAuditService.getAuditStatus(projectId, (req as AuthenticatedRequest).user.id, auditId)
        return res.json(status)
    } catch (error: any) {
        return res.status(404).json({ error: error.message })
    }
}

export async function getAuditResultsController(req: Request, res: Response) {
    try {
        const projectId = param(req.params.projectId)
        const auditId = param(req.params.auditId)
        const results = await SiteAuditService.getAuditResults(projectId, (req as AuthenticatedRequest).user.id, auditId)
        return res.json(results)
    } catch (error: any) {
        return res.status(404).json({ error: error.message })
    }
}

export async function getAuditHistoryController(req: Request, res: Response) {
    try {
        const projectId = param(req.params.projectId)
        const history = await SiteAuditService.getHistory(projectId, (req as AuthenticatedRequest).user.id)
        return res.json({ history })
    } catch (error: any) {
        return res.status(400).json({ error: error.message })
    }
}

export async function deleteAuditController(req: Request, res: Response) {
    try {
        const projectId = param(req.params.projectId)
        const auditId = param(req.params.auditId)
        await SiteAuditService.deleteAudit(projectId, (req as AuthenticatedRequest).user.id, auditId)
        return res.json({ success: true })
    } catch (error: any) {
        return res.status(400).json({ error: error.message })
    }
}
