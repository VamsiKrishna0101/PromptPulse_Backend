import prisma from "../../../lib/prisma"
import { buildSeoContentOpportunities } from "./seo_content_planner"
import { buildSeoKeywordOpportunities } from "./seo_keyword_intelligence_service"
import { buildSeoLocalChecklist } from "./seo_local_checklist_service"
import { buildSeedSeoQueries } from "./seo_seed_query_service"
import type { SeoIntelligence } from "./seo_intelligence_types"
import { isBrightDataSerpConfigured } from "../rank_tracking/brightdata_serp_client"

const RECENT_CHAT_WINDOW_DAYS = 30

export async function buildSeoIntelligence(projectId: string, auditId?: string | null): Promise<SeoIntelligence> {
    const since = new Date(Date.now() - RECENT_CHAT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const [project, prompts, audit] = await Promise.all([
        prisma.project.findUnique({
            where: { id: projectId },
            include: { brand_preference: true },
        }),
        prisma.prompt.findMany({
            where: { project_id: projectId, status: { in: ["ACTIVE", "SUGGESTED"] } },
            select: {
                id: true,
                text: true,
                topic: true,
                tags: true,
                priority_score: true,
                chats: {
                    where: { created_at: { gte: since } },
                    select: { brand_mentioned: true, brand_position: true },
                    take: 120,
                },
            },
            orderBy: [{ priority_score: "desc" }, { created_at: "asc" }],
            take: 80,
        }),
        auditId
            ? prisma.seoAudit.findFirst({
                where: { id: auditId, project_id: projectId },
                include: { pages: { orderBy: { created_at: "asc" }, take: 50 } },
            })
            : prisma.seoAudit.findFirst({
                where: { project_id: projectId },
                orderBy: { created_at: "desc" },
                include: { pages: { orderBy: { created_at: "asc" }, take: 50 } },
            }),
    ])

    const pages = audit?.pages ?? []
    const rankResults = audit?.id
        ? await prisma.seoRankResult.findMany({ where: { audit_id: audit.id } })
        : []
    const rankByKeyword = new Map(rankResults.map(result => [result.keyword, {
        google_rank: result.google_rank,
        ranking_url: result.ranking_url,
        ranking_title: result.ranking_title,
        related_queries: Array.isArray(result.related_queries)
            ? result.related_queries.filter((value): value is string => typeof value === "string")
            : [],
    }]))
    const seoPrompts = prompts.length
        ? prompts
        : buildSeedSeoQueries({
            brandName: project?.brand_name ?? "your brand",
            location: project?.brand_location ?? "",
            industry: project?.brand_preference?.industry_category ?? "business",
            pages,
        })
    const keywords = buildSeoKeywordOpportunities({ prompts: seoPrompts, pages, rankByKeyword })
    const googleEnabled = isBrightDataSerpConfigured()
    const pendingKeywords = rankResults.filter(r => r.status === "PENDING").length
    const checkedKeywords = rankResults.filter(r => r.status === "COMPLETED").length
    
    let message = "Bright Data SERP tracking is configured and will run on the next full audit."
    if (!googleEnabled) {
        message = "Add BRIGHT_DATA_API_KEY and BRIGHT_DATA_SERP_DATASET_ID to enable real Google positions."
    } else if (pendingKeywords > 0) {
        message = `Bright Data is currently tracking ${pendingKeywords} Google keyword${pendingKeywords === 1 ? "" : "s"} in the background. Check back in a few minutes.`
    } else if (checkedKeywords > 0) {
        message = `Bright Data checked ${checkedKeywords} Google keyword${checkedKeywords === 1 ? "" : "s"}.`
    }

    return {
        keywords,
        content_opportunities: buildSeoContentOpportunities(keywords),
        local_checklist: buildSeoLocalChecklist({
            pages,
            location: project?.brand_location ?? "",
            industry: project?.brand_preference?.industry_category ?? "Business",
        }),
        rank_tracking: {
            google_enabled: googleEnabled,
            checked_keywords: checkedKeywords,
            message,
        },
    }
}
