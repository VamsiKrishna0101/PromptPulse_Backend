import prisma from "../../lib/prisma"
import { spendCredits, refundCredits } from "../credits/credits_service"
import { CREDIT_COSTS } from "../subscription/plan_config"
import { crawlSeoSite } from "./seo_crawler_service"
import { analyzeTechnicalSeo } from "./seo_technical_analyzer"
import { analyzeAiReadiness } from "./seo_ai_readiness_analyzer"
import { analyzeLocalSeo } from "./seo_local_analyzer"
import { analyzeSchemaSeo } from "./seo_schema_analyzer"
import { buildSeoContentGaps } from "./seo_content_gap_service"
import { calculateSeoScores } from "./seo_scoring"
import { buildSeoActions } from "./seo_action_builder"
import type { CrawledSeoPage, SeoIssueInput } from "./seo_types"

export const SEO_QUICK_SCAN_CREDIT_COST = 3
export const SEO_FULL_AUDIT_MAX_CREDIT_COST = CREDIT_COSTS.seo_audit
export type SeoAuditMode = "quick" | "full"

function issueSort(a: SeoIssueInput, b: SeoIssueInput) {
    return b.priority_score - a.priority_score
}

function normalizeAuditUrl(url: string) {
    const trimmed = url.trim()
    if (!trimmed) throw new Error("URL is required")
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export async function runSeoAudit(input: {
    projectId: string
    userId: string
    url?: string
    mode?: SeoAuditMode
    idempotencyKey?: string
}) {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        include: { brand_preference: true },
    })

    const auditUrl = normalizeAuditUrl(input.url ?? project.brand_url)
    const mode = input.mode === "quick" ? "quick" : "full"
    const maxPages = mode === "quick" ? 1 : 25
    const maxCredits = mode === "quick" ? SEO_QUICK_SCAN_CREDIT_COST : SEO_FULL_AUDIT_MAX_CREDIT_COST
    const idempotencyKey = input.idempotencyKey ?? `seo-audit:${mode}:${input.userId}:${input.projectId}:${Date.now()}`

    await spendCredits({
        userId: input.userId,
        amount: maxCredits,
        action: "seo_audit",
        description: mode === "quick" ? "Quick AI SEO scan" : "Full AI SEO website audit",
        idempotencyKey,
        metadata: { project_id: input.projectId, url: auditUrl, mode, max_pages: maxPages },
    })

    try {
        const [pages, prompts] = await Promise.all([
            crawlSeoSite({ rootUrl: auditUrl, projectLocation: project.brand_location, maxPages }),
            prisma.prompt.findMany({
                where: { project_id: input.projectId, status: { in: ["ACTIVE", "SUGGESTED"] } },
                select: { id: true, text: true, tags: true, priority_score: true, topic: true },
                orderBy: { priority_score: "desc" },
                take: 80,
            }),
        ])

        const technicalIssues = analyzeTechnicalSeo(pages)
        const aiIssues = analyzeAiReadiness({
            pages,
            brandName: project.brand_name,
            location: project.brand_location,
            industry: project.brand_preference?.industry_category ?? "Business",
        })
        const localIssues = analyzeLocalSeo({
            pages,
            location: project.brand_location,
            industry: project.brand_preference?.industry_category ?? "Business",
        })
        const schemaIssues = analyzeSchemaSeo({
            pages,
            industry: project.brand_preference?.industry_category ?? "Business",
        })
        const contentGaps = mode === "full"
            ? await buildSeoContentGaps({ pages, prompts })
            : { issues: [], actions: [] }
        const issues = [...technicalIssues, ...aiIssues, ...localIssues, ...schemaIssues, ...contentGaps.issues].sort(issueSort)
        const actions = buildSeoActions(issues, contentGaps.actions)
        const scores = calculateSeoScores(issues)
        // SEO audits have a fixed price because the full workflow reserves crawl
        // capacity and can also run Bright Data SERP checks for up to 10 keywords.
        // Failed audits are still fully refunded in the catch block below.
        const actualCredits = maxCredits

        const audit = await prisma.$transaction(async tx => {
            const createdAudit = await tx.seoAudit.create({
                data: {
                    project_id: input.projectId,
                    user_id: input.userId,
                    url: auditUrl,
                    credits_spent: actualCredits,
                    ...scores,
                },
            })

            const pageIdByUrl = new Map<string, string>()
            for (const page of pages) {
                const createdPage = await tx.seoAuditPage.create({
                    data: {
                        audit_id: createdAudit.id,
                        url: page.url,
                        status_code: page.status_code,
                        title: page.title,
                        meta_description: page.meta_description,
                        h1: page.h1,
                        canonical: page.canonical,
                        word_count: page.word_count,
                        indexable: page.indexable,
                        has_viewport: page.has_viewport,
                        has_schema: page.has_schema,
                        has_faq: page.has_faq,
                        detected_services: page.detected_services,
                        detected_locations: page.detected_locations,
                        page_type: page.page_type,
                    },
                })
                pageIdByUrl.set(page.url, createdPage.id)
            }

            for (const issue of issues.slice(0, 120)) {
                await tx.seoIssue.create({
                    data: {
                        audit_id: createdAudit.id,
                        page_id: issue.page_url ? pageIdByUrl.get(issue.page_url) : undefined,
                        category: issue.category,
                        severity: issue.severity,
                        title: issue.title,
                        description: issue.description,
                        recommendation: issue.recommendation,
                        priority_score: issue.priority_score,
                    },
                })
            }

            for (const action of actions) {
                await tx.seoAction.create({
                    data: {
                        project_id: input.projectId,
                        audit_id: createdAudit.id,
                        action_type: action.action_type,
                        title: action.title,
                        description: action.description,
                        page_url: action.page_url ?? null,
                        priority: action.priority,
                        difficulty: action.difficulty,
                        related_prompt_ids: action.related_prompt_ids ?? [],
                        related_sources: action.related_sources ?? [],
                    },
                })
            }

            return createdAudit
        })

        return getSeoAudit(input.projectId, audit.id)
    } catch (error) {
        await refundCredits({
            userId: input.userId,
            amount: maxCredits,
            action: "seo_audit",
            description: "Refund for failed AI SEO audit",
            idempotencyKey,
            metadata: { project_id: input.projectId, url: auditUrl, mode },
        })
        throw error
    }
}

export async function getLatestSeoAudit(projectId: string) {
    const latest = await prisma.seoAudit.findFirst({
        where: { project_id: projectId },
        orderBy: { created_at: "desc" },
        select: { id: true },
    })
    if (!latest) return null
    return getSeoAudit(projectId, latest.id)
}

export async function getSeoAudit(projectId: string, auditId: string) {
    return prisma.seoAudit.findFirst({
        where: { id: auditId, project_id: projectId },
        include: {
            pages: { orderBy: { created_at: "asc" }, take: 50 },
            issues: {
                orderBy: { priority_score: "desc" },
                take: 80,
                include: {
                    page: {
                        select: {
                            id: true,
                            url: true,
                            title: true,
                            page_type: true,
                            status_code: true,
                        },
                    },
                },
            },
            actions: { orderBy: [{ priority: "asc" }, { created_at: "asc" }], take: 40 },
        },
    })
}

export function summarizePages(pages: CrawledSeoPage[]) {
    return {
        crawled: pages.length,
        indexable: pages.filter(page => page.indexable).length,
        with_schema: pages.filter(page => page.has_schema).length,
        with_faq: pages.filter(page => page.has_faq).length,
    }
}
