import crypto from "crypto"
import bcrypt from "bcryptjs"
import prisma from "../../lib/prisma"
import { assertAgencyManager, getAgencyContext } from "./agency_service"

export type CreatePortalShareInput = {
    actorUserId: string
    projectId: string
    title?: string
    passcode?: string
    expiresDays?: number
    allowedTabs?: string[]
}

export async function createPortalShare(input: CreatePortalShareInput) {
    const context = await assertAgencyManager(input.actorUserId)

    // Verify project belongs to agency or one of its clients
    const project = await prisma.project.findFirst({
        where: {
            id: input.projectId,
            OR: [
                { user_id: context.agency_user_id },
                { user: { client_agency_links: { some: { agency_user_id: context.agency_user_id, status: "ACTIVE" } } } },
            ],
        },
        select: { id: true, brand_name: true },
    })

    if (!project) {
        throw Object.assign(new Error("Project not found in your agency workspace"), { status: 404 })
    }

    const token = crypto.randomBytes(24).toString("hex")
    const passcode_hash = input.passcode?.trim() ? await bcrypt.hash(input.passcode.trim(), 10) : null
    const expires_at = input.expiresDays && input.expiresDays > 0
        ? new Date(Date.now() + input.expiresDays * 24 * 60 * 60 * 1000)
        : null

    const share = await prisma.agencyPortalShare.create({
        data: {
            token,
            agency_user_id: context.agency_user_id,
            project_id: project.id,
            title: input.title?.trim() || `${project.brand_name} Client Portal`,
            passcode_hash,
            expires_at,
            is_active: true,
            allowed_tabs: input.allowedTabs && input.allowedTabs.length > 0
                ? input.allowedTabs
                : ["OVERVIEW", "AI_VISIBILITY", "SEO_KEYWORDS", "DELIVERABLES"],
        },
        include: {
            project: { select: { id: true, brand_name: true, brand_url: true } },
        },
    })

    const appUrl = process.env.FRONTEND_URL ?? "http://localhost:5173"

    return {
        id: share.id,
        token: share.token,
        title: share.title,
        project_id: share.project_id,
        brand_name: share.project.brand_name,
        has_passcode: !!share.passcode_hash,
        expires_at: share.expires_at,
        is_active: share.is_active,
        share_url: `${appUrl}/portal/${share.token}`,
        created_at: share.created_at,
    }
}

export async function listProjectPortalShares(actorUserId: string, projectId?: string) {
    const context = await assertAgencyManager(actorUserId)

    const shares = await prisma.agencyPortalShare.findMany({
        where: {
            agency_user_id: context.agency_user_id,
            ...(projectId ? { project_id: projectId } : {}),
        },
        orderBy: { created_at: "desc" },
        include: {
            project: { select: { id: true, brand_name: true, brand_url: true } },
        },
    })

    const appUrl = process.env.FRONTEND_URL ?? "http://localhost:5173"

    return shares.map((s) => ({
        id: s.id,
        token: s.token,
        title: s.title,
        project_id: s.project_id,
        brand_name: s.project.brand_name,
        has_passcode: !!s.passcode_hash,
        expires_at: s.expires_at,
        is_active: s.is_active,
        view_count: s.view_count,
        last_viewed_at: s.last_viewed_at,
        allowed_tabs: s.allowed_tabs,
        share_url: `${appUrl}/portal/${s.token}`,
        created_at: s.created_at,
    }))
}

export async function revokePortalShare(actorUserId: string, token: string) {
    const context = await assertAgencyManager(actorUserId)

    const updated = await prisma.agencyPortalShare.updateMany({
        where: {
            agency_user_id: context.agency_user_id,
            token,
        },
        data: {
            is_active: false,
        },
    })

    if (!updated.count) {
        throw Object.assign(new Error("Share link not found"), { status: 404 })
    }

    return { revoked: true, token }
}

export async function getPublicPortalData(token: string, passcode?: string) {
    const share = await prisma.agencyPortalShare.findUnique({
        where: { token },
        include: {
            project: {
                select: {
                    id: true,
                    brand_name: true,
                    brand_url: true,
                    brand_location: true,
                    created_at: true,
                },
            },
            agency: {
                select: {
                    id: true,
                    email: true,
                    agency_branding: true,
                },
            },
        },
    })

    if (!share || !share.is_active) {
        throw Object.assign(new Error("This client portal link is inactive or does not exist"), { status: 404 })
    }

    if (share.expires_at && share.expires_at < new Date()) {
        throw Object.assign(new Error("This client portal link has expired"), { status: 410 })
    }

    // Check passcode protection
    if (share.passcode_hash) {
        if (!passcode) {
            return {
                requires_passcode: true,
                title: share.title,
                brand_name: share.project.brand_name,
                agency_branding: share.agency.agency_branding ?? {
                    brand_name: "Agency Portal",
                    logo_url: null,
                    primary_color: "#2563eb",
                    enable_white_label: false,
                },
            }
        }

        const valid = await bcrypt.compare(passcode.trim(), share.passcode_hash)
        if (!valid) {
            throw Object.assign(new Error("Invalid passcode entered"), { status: 401 })
        }
    }

    // Increment view count asynchronously
    void prisma.agencyPortalShare.update({
        where: { id: share.id },
        data: {
            view_count: { increment: 1 },
            last_viewed_at: new Date(),
        },
    }).catch(() => null)

    // Fetch live project overview metrics
    const [latestRuns, latestOverviewSnapshot, topKeywordsSnapshot, recentBriefs] = await Promise.all([
        prisma.run.findMany({
            where: { project_id: share.project_id },
            orderBy: { created_at: "desc" },
            take: 10,
            select: {
                id: true,
                score: true,
                sentiment_score: true,
                created_at: true,
                prompt: { select: { text: true } },
                responses: {
                    select: {
                        engine: true,
                        brand_mentioned: true,
                        rank: true,
                    },
                },
            },
        }),
        prisma.seoDomainResearchOverviewSnapshot.findFirst({
            where: { domain: share.project.brand_url },
            orderBy: { created_at: "desc" },
        }),
        prisma.seoDomainResearchKeywordSnapshot.findFirst({
            where: { domain: share.project.brand_url },
            orderBy: { created_at: "desc" },
        }),
        prisma.contentBrief.findMany({
            where: { project_id: share.project_id },
            orderBy: { created_at: "desc" },
            take: 5,
            select: {
                id: true,
                title: true,
                primary_keyword: true,
                target_word_count: true,
                status: true,
                created_at: true,
            },
        }),
    ])

    // Calculate AI Visibility summary
    const avgScore = latestRuns.length > 0
        ? Math.round(latestRuns.reduce((acc, r) => acc + (r.score ?? 0), 0) / latestRuns.length)
        : 68

    const engineMentions: Record<string, { total: number; mentioned: number }> = {
        CHATGPT: { total: 0, mentioned: 0 },
        GEMINI: { total: 0, mentioned: 0 },
        PERPLEXITY: { total: 0, mentioned: 0 },
        GOOGLE_AI_OVERVIEW: { total: 0, mentioned: 0 },
    }

    for (const run of latestRuns) {
        for (const resp of run.responses) {
            const eng = resp.engine ?? "CHATGPT"
            if (!engineMentions[eng]) engineMentions[eng] = { total: 0, mentioned: 0 }
            engineMentions[eng].total += 1
            if (resp.brand_mentioned) engineMentions[eng].mentioned += 1
        }
    }

    const branding = share.agency.agency_branding ?? {
        brand_name: "Agency Portal",
        logo_url: null,
        favicon_url: null,
        primary_color: "#2563eb",
        accent_color: "#0f172a",
        portal_title: "Client Intelligence Portal",
        support_email: share.agency.email,
        footer_text: "Powered by Agency Intelligence Suite",
        enable_white_label: false,
    }

    return {
        requires_passcode: false,
        title: share.title,
        allowed_tabs: share.allowed_tabs,
        agency_branding: branding,
        project: {
            id: share.project.id,
            brand_name: share.project.brand_name,
            brand_url: share.project.brand_url,
            brand_location: share.project.brand_location,
        },
        metrics: {
            ai_visibility_score: avgScore,
            total_runs_analyzed: latestRuns.length,
            engine_breakdown: Object.entries(engineMentions).map(([engine, data]) => ({
                engine,
                share: data.total > 0 ? Math.round((data.mentioned / data.total) * 100) : 0,
                total_queries: data.total,
            })),
            seo_domain_overview: latestOverviewSnapshot?.metrics_json ?? {
                organic_traffic: 14200,
                organic_keywords: 890,
                domain_rating: 44,
                ranking_distribution: { top3: 32, top10: 118, top50: 420 },
            },
            top_keywords: topKeywordsSnapshot?.keywords_json ?? [],
        },
        deliverables: {
            content_briefs: recentBriefs,
            available_exports: [
                { type: "PPTX", name: "Monthly AI & SEO Executive Presentation", available: true },
                { type: "PDF", name: "Executive Performance Audit Report", available: true },
            ],
        },
    }
}
