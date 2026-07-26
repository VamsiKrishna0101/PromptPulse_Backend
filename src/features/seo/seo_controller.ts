import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { assertProjectAccess } from "../projects/project_access"
import { buildSeoIntelligence } from "./intelligence/seo_intelligence_service"
import { SEO_FULL_AUDIT_MAX_CREDIT_COST, SEO_QUICK_SCAN_CREDIT_COST, getLatestSeoAudit, runSeoAudit, type SeoAuditMode } from "./seo_audit_service"
import prisma from "../../lib/prisma"
import { trackSeoKeywordRanks } from "./rank_tracking/seo_rank_tracking_service"

const SEO_COSTS = {
    quick_scan: SEO_QUICK_SCAN_CREDIT_COST,
    full_audit_max: SEO_FULL_AUDIT_MAX_CREDIT_COST,
}

function readString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readIdempotencyKey(req: Request) {
    const header = req.header("Idempotency-Key")
    if (header?.trim()) return header.trim().slice(0, 180)
    return undefined
}

export async function getLatestSeoAuditController(req: Request, res: Response) {
    try {
        const projectId = readString(req.params.project_id)
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        await assertProjectAccess(projectId, (req as AuthenticatedRequest).user.id)
        const audit = await getLatestSeoAudit(projectId)
        const intelligence = await buildSeoIntelligence(projectId, audit?.id)
        res.status(200).json({ audit, intelligence, costs: SEO_COSTS })
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }
        res.status(500).json({ error: "Failed to load SEO audit" })
    }
}

export async function getSeoAuditController(req: Request, res: Response) {
    try {
        const projectId = readString(req.params.project_id)
        const auditId = readString(req.params.audit_id)
        if (!projectId || !auditId) {
            res.status(400).json({ error: "project_id and audit_id are required" })
            return
        }

        await assertProjectAccess(projectId, (req as AuthenticatedRequest).user.id)
        
        // Use getSeoAudit to fetch the audit and all its related items
        const { getSeoAudit } = await import("./seo_audit_service")
        const audit = await getSeoAudit(projectId, auditId)
        
        if (!audit) {
            res.status(404).json({ error: "Audit not found" })
            return
        }
        
        const intelligence = await buildSeoIntelligence(projectId, audit.id)
        res.status(200).json({ audit, intelligence, costs: SEO_COSTS })
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }
        res.status(500).json({ error: "Failed to load SEO audit" })
    }
}

export async function listSeoAuditsController(req: Request, res: Response) {
    try {
        const projectId = readString(req.params.project_id)
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }
        await assertProjectAccess(projectId, (req as AuthenticatedRequest).user.id)
        const audits = await prisma.seoAudit.findMany({
            where: { project_id: projectId },
            orderBy: { created_at: "desc" },
            take: 10,
            select: {
                id: true,
                url: true,
                overall_score: true,
                technical_score: true,
                ai_readiness_score: true,
                local_score: true,
                content_score: true,
                schema_score: true,
                credits_spent: true,
                created_at: true,
                _count: { select: { pages: true, issues: true } },
            },
        })
        res.status(200).json({ audits, costs: SEO_COSTS })
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }
        res.status(500).json({ error: "Failed to load SEO audit history" })
    }
}

export async function runSeoAuditController(req: Request, res: Response) {
    const userId = (req as AuthenticatedRequest).user.id
    try {
        const projectId = readString(req.params.project_id)
        if (!projectId) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        await assertProjectAccess(projectId, userId)
        const requestedMode = readString(req.body?.mode)
        const mode: SeoAuditMode = requestedMode === "quick" ? "quick" : "full"

        const audit = await runSeoAudit({
            projectId,
            userId,
            url: readString(req.body?.url),
            mode,
            idempotencyKey: readIdempotencyKey(req),
        })
        let intelligence = await buildSeoIntelligence(projectId, audit?.id)
        if (audit?.id && mode === "full" && intelligence.keywords.length) {
            // Run Bright Data SERP tracking asynchronously so we don't block the HTTP response
            // Bright Data polling can take 10+ minutes.
            trackSeoKeywordRanks({
                projectId,
                auditId: audit.id,
                targetUrl: audit.url,
                keywords: intelligence.keywords.map(keyword => ({ keyword: keyword.keyword })),
            }).catch(error => {
                console.error("[seo] Bright Data SERP tracking failed in background:", error)
            })
        }
        res.status(201).json({ audit, intelligence, costs: SEO_COSTS })
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }
        if (error instanceof Error && error.message.startsWith("Not enough credits")) {
            res.status(402).json({ error: error.message })
            return
        }
        res.status(500).json({ error: error instanceof Error ? error.message : "Failed to run SEO audit" })
    }
}
