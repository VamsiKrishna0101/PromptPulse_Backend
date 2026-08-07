import { runCrawl } from "./site_audit_crawler"
import { normalizeAuditUrl } from "./site_audit_url_policy"
import prisma from "../../../lib/prisma"
import { assertProjectAccess } from "../../projects/project_access"
import crypto from "node:crypto"
import { refundCredits, spendCredits } from "../../credits/credits_service"
import { getSiteAuditCreditCost } from "../../payments/credits_service"

export class SiteAuditService {
    static async startAudit(projectId: string, userId: string, startUrl: string, maxPages: number) {
        await assertProjectAccess(projectId, userId)
        const normalizedUrl = normalizeAuditUrl(startUrl, startUrl)
        if (!normalizedUrl) {
            throw new Error("Invalid start URL")
        }

        // Check if there's already a running audit for this project
        const runningAudit = await prisma.seoAudit.findFirst({
            where: {
                project_id: projectId,
                status: { in: ["QUEUED", "RUNNING"] }
            }
        })

        if (runningAudit) {
            throw new Error("An audit is already running for this project.")
        }

        const auditId = crypto.randomUUID()
        const credits = await getSiteAuditCreditCost(userId, maxPages)
        const idempotencyKey = `site-audit:${userId}:${projectId}:${auditId}`

        // Charge credits upfront before starting the crawl
        await spendCredits({
            userId,
            amount: credits,
            action: "SEO_SITE_AUDIT",
            description: `Site audit (${maxPages <= 25 ? "quick" : maxPages <= 100 ? "standard" : "deep"}, up to ${maxPages} pages)`,
            idempotencyKey,
            metadata: {
                project_id: projectId,
                audit_id: auditId,
                max_pages: maxPages,
            },
        })

        let audit
        try {
            audit = await prisma.seoAudit.create({
                data: {
                    id: auditId,
                    project_id: projectId,
                    user_id: userId,
                    url: normalizedUrl,
                    status: "RUNNING",
                }
            })
        } catch (error) {
            // Refund credits if the audit record could not be created
            await refundCredits({
                userId,
                amount: credits,
                action: "SEO_SITE_AUDIT_REFUND",
                description: "Site audit refund — failed to start",
                idempotencyKey: `refund:${idempotencyKey}`,
                metadata: { project_id: projectId, audit_id: auditId },
            })
            throw error
        }

        // Spawn crawler asynchronously
        setTimeout(() => {
            runCrawl(audit.id, normalizedUrl, maxPages).catch(console.error)
        }, 0)

        return { auditId: audit.id, creditsCharged: credits }
    }

    static async getAuditStatus(projectId: string, userId: string, auditId: string) {
        await assertProjectAccess(projectId, userId)
        const audit = await prisma.seoAudit.findFirst({
            where: { id: auditId, project_id: projectId },
            include: {
                _count: {
                    select: { pages: true, issues: true }
                }
            }
        })

        if (!audit) {
            throw new Error("Audit not found")
        }

        return {
            id: audit.id,
            status: audit.status,
            url: audit.url,
            pagesCrawled: audit._count.pages,
            issuesFound: audit._count.issues,
            overallScore: audit.overall_score,
            createdAt: audit.created_at,
            errorReason: audit.error_reason
        }
    }

    static async getAuditResults(projectId: string, userId: string, auditId: string) {
        await assertProjectAccess(projectId, userId)
        const audit = await prisma.seoAudit.findFirst({
            where: { id: auditId, project_id: projectId },
            include: {
                pages: true,
                issues: true
            }
        })

        if (!audit) {
            throw new Error("Audit not found")
        }

        return audit
    }

    static async getHistory(projectId: string, userId: string) {
        await assertProjectAccess(projectId, userId)
        return prisma.seoAudit.findMany({
            where: { project_id: projectId },
            orderBy: { created_at: "desc" },
            include: {
                _count: {
                    select: { pages: true }
                }
            }
        })
    }

    static async deleteAudit(projectId: string, userId: string, auditId: string) {
        await assertProjectAccess(projectId, userId)
        const audit = await prisma.seoAudit.findFirst({
            where: { id: auditId, project_id: projectId }
        })

        if (!audit) {
            throw new Error("Audit not found")
        }

        await prisma.seoAudit.delete({
            where: { id: auditId }
        })
    }
}
