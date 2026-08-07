import bcrypt from "bcryptjs"
import crypto from "crypto"
import { AgencyInvitationStatus, AgencyInvitationType, AgencyMembershipRole, AgencyMembershipStatus } from "@prisma/client"
import prisma from "../../lib/prisma"
import { sendAgencyInvitationEmail } from "../email/email_service"
import { generateAccessToken, generateRefreshToken } from "../../utils/jwt"

export type AgencyClientSummary = {
    link_id: string
    client_user_id: string
    client_email: string
    role: string
    status: string
    category: string
    monthly_credit_cap: number
    assigned_manager_id: string | null
    linked_at: Date
    project_count: number
    projects: {
        id: string
        brand_name: string
        brand_url: string
        brand_location: string
        created_at: Date
        ai_visibility_score?: number
        prompts_count: number
        runs_count: number
        competitors_count: number
    }[]
}

const STAFF_ROLES = new Set<AgencyMembershipRole>([AgencyMembershipRole.ADMIN, AgencyMembershipRole.MANAGER, AgencyMembershipRole.ANALYST])

function agencyRoleCanManage(role: AgencyMembershipRole) {
    return role === AgencyMembershipRole.OWNER || role === AgencyMembershipRole.ADMIN
}

async function requireAgencyOwner(agencyUserId: string) {
    const user = await prisma.user.findUnique({ where: { id: agencyUserId }, select: { id: true, email: true, account_type: true, credits_balance: true } })
    if (!user || user.account_type !== "AGENCY") throw Object.assign(new Error("Agency account required"), { status: 403 })
    return user
}

export async function getAgencyContext(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, account_type: true } })
    if (!user) throw Object.assign(new Error("User not found"), { status: 404 })
    if (user.account_type === "AGENCY") return { agency_user_id: user.id, role: AgencyMembershipRole.OWNER }

    const membership = await prisma.agencyMembership.findFirst({
        where: { member_user_id: userId, status: AgencyMembershipStatus.ACTIVE },
        select: { agency_user_id: true, role: true },
    })
    if (membership) return membership

    const clientLink = await prisma.agencyClientLink.findFirst({
        where: { client_user_id: userId, status: "ACTIVE" },
        select: { agency_user_id: true, role: true },
    })
    return clientLink ? { agency_user_id: clientLink.agency_user_id, role: clientLink.role as AgencyMembershipRole } : null
}

export async function assertAgencyManager(userId: string) {
    const context = await getAgencyContext(userId)
    if (!context || !agencyRoleCanManage(context.role)) throw Object.assign(new Error("Agency admin access required"), { status: 403 })
    await requireAgencyOwner(context.agency_user_id)
    return context
}

export async function listAgencyClients(agencyUserId: string): Promise<AgencyClientSummary[]> {
    const owner = await requireAgencyOwner(agencyUserId)

    // 1. Fetch direct projects owned by this agency
    const directProjects = await prisma.project.findMany({
        where: { user_id: agencyUserId },
        orderBy: { created_at: "desc" },
        select: {
            id: true,
            brand_name: true,
            brand_url: true,
            brand_location: true,
            created_at: true,
            _count: { select: { prompts: true, runs: true, competitors: true } },
        },
    })

    // 2. Fetch linked external client accounts
    const links = await prisma.agencyClientLink.findMany({
        where: { agency_user_id: agencyUserId },
        orderBy: { created_at: "desc" },
        include: {
            client: {
                select: {
                    id: true,
                    email: true,
                    projects: {
                        select: {
                            id: true,
                            brand_name: true,
                            brand_url: true,
                            brand_location: true,
                            created_at: true,
                            _count: { select: { prompts: true, runs: true, competitors: true } },
                        },
                    },
                    _count: { select: { projects: true } },
                },
            },
        },
    })

    // 3. Compute AI visibility scores per project from Chat.brand_mentioned
    const allProjectIds = [
        ...directProjects.map(p => p.id),
        ...links.flatMap(l => l.client.projects.map(p => p.id)),
    ]

    const scoreMap = new Map<string, number>()
    if (allProjectIds.length > 0) {
        // Aggregate brand_mentioned rate per project via prompt -> run -> chat
        const chatAgg = await prisma.chat.groupBy({
            by: ["prompt_id"],
            where: {
                prompt: { project_id: { in: allProjectIds } },
            },
            _count: { id: true },
            _sum: { brand_mentioned: true } as never,
        }).catch(() => [] as never[])

        // Simpler: aggregate directly with raw counts per project
        const projectChats = await prisma.chat.findMany({
            where: {
                prompt: { project_id: { in: allProjectIds } },
            },
            select: {
                brand_mentioned: true,
                prompt: { select: { project_id: true } },
            },
        }).catch(() => [])

        // Compute mention rate per project
        const totals = new Map<string, { total: number; mentioned: number }>()
        for (const chat of projectChats) {
            const pid = chat.prompt.project_id
            const entry = totals.get(pid) ?? { total: 0, mentioned: 0 }
            entry.total++
            if (chat.brand_mentioned) entry.mentioned++
            totals.set(pid, entry)
        }
        for (const [pid, { total, mentioned }] of totals.entries()) {
            if (total > 0) scoreMap.set(pid, Math.round((mentioned / total) * 100))
        }
    }

    const results: AgencyClientSummary[] = []

    // If agency has direct projects, include them as a managed workspace group
    if (directProjects.length > 0) {
        results.push({
            link_id: `agency-direct-${owner.id}`,
            client_user_id: owner.id,
            client_email: owner.email,
            role: "OWNER",
            status: "ACTIVE",
            category: "Agency Direct",
            monthly_credit_cap: owner.credits_balance,
            assigned_manager_id: null,
            linked_at: new Date(),
            project_count: directProjects.length,
            projects: directProjects.map(p => ({
                id: p.id,
                brand_name: p.brand_name,
                brand_url: p.brand_url,
                brand_location: p.brand_location,
                created_at: p.created_at,
                ai_visibility_score: scoreMap.get(p.id),
                prompts_count: p._count.prompts,
                runs_count: p._count.runs,
                competitors_count: p._count.competitors,
            })),
        })
    }

    // Append linked external clients
    for (const link of links) {
        results.push({
            link_id: link.id,
            client_user_id: link.client_user_id,
            client_email: link.client.email,
            role: link.role,
            status: link.status,
            category: link.category ?? "Client Workspace",
            monthly_credit_cap: link.monthly_credit_cap ?? 10000,
            assigned_manager_id: link.assigned_manager_id ?? null,
            linked_at: link.created_at,
            project_count: link.client._count.projects,
            projects: link.client.projects.map(p => ({
                id: p.id,
                brand_name: p.brand_name,
                brand_url: p.brand_url,
                brand_location: p.brand_location,
                created_at: p.created_at,
                ai_visibility_score: scoreMap.get(p.id),
                prompts_count: p._count.prompts,
                runs_count: p._count.runs,
                competitors_count: p._count.competitors,
            })),
        })
    }

    return results
}

export async function getAgencyPortfolio(agencyUserId: string) {
    const owner = await requireAgencyOwner(agencyUserId)
    const [clients, members, branding] = await Promise.all([
        listAgencyClients(agencyUserId),
        listAgencyMembers(agencyUserId),
        prisma.agencyBranding.findUnique({ where: { agency_user_id: agencyUserId } }),
    ])

    const totalProjects = clients.reduce((sum, c) => sum + (c.project_count || c.projects.length), 0)
    const activeClients = clients.filter(c => c.status === "ACTIVE").length

    // Calculate real average AI visibility across all projects with scores
    const allScores = clients.flatMap(c => c.projects.map(p => p.ai_visibility_score).filter((s): s is number => typeof s === "number"))
    const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null

    return {
        agency_id: owner.id,
        agency_email: owner.email,
        credits_balance: owner.credits_balance,
        total_clients: clients.length,
        active_clients: activeClients,
        total_projects: totalProjects,
        total_team_members: members.length,
        avg_ai_visibility_score: avgScore,
        white_label_enabled: branding?.enable_white_label ?? false,
        branding: branding ?? {
            brand_name: "Agency Portal",
            primary_color: "#2563eb",
            accent_color: "#0f172a",
            portal_title: "Client Intelligence Portal",
            enable_white_label: false,
        },
        clients,
        team_members: members,
    }
}

export type AgencyDeliverable = {
    id: string
    title: string
    type: "BRIEF" | "AI_REPORT" | "SEO_AUDIT"
    clientName: string
    projectId: string
    targetKeyword?: string
    status: string
    date: string
    createdAt: Date
}

export async function listAgencyDeliverables(agencyUserId: string, projectId?: string): Promise<AgencyDeliverable[]> {
    const context = await getAgencyContext(agencyUserId)
    if (!context) throw Object.assign(new Error("Agency access required"), { status: 403 })

    // Find all accessible project IDs
    const clients = await listAgencyClients(context.agency_user_id)
    const allProjects = clients.flatMap(c => c.projects)
    const targetProjectIds = projectId
        ? allProjects.filter(p => p.id === projectId).map(p => p.id)
        : allProjects.map(p => p.id)

    if (targetProjectIds.length === 0) return []

    const [briefs, aiReports, seoAudits] = await Promise.all([
        prisma.contentBrief.findMany({
            where: { project_id: { in: targetProjectIds } },
            orderBy: { created_at: "desc" },
            take: 20,
            include: { project: { select: { id: true, brand_name: true } } },
        }),
        prisma.aIReport.findMany({
            where: { project_id: { in: targetProjectIds } },
            orderBy: { created_at: "desc" },
            take: 20,
            include: { project: { select: { id: true, brand_name: true } } },
        }),
        prisma.seoAudit.findMany({
            where: { project_id: { in: targetProjectIds } },
            orderBy: { created_at: "desc" },
            take: 20,
            include: { project: { select: { id: true, brand_name: true } } },
        }),
    ])

    const deliverables: AgencyDeliverable[] = []

    for (const b of briefs) {
        deliverables.push({
            id: b.id,
            title: b.title || `Content Brief: ${b.primary_keyword}`,
            type: "BRIEF",
            clientName: b.project.brand_name,
            projectId: b.project.id,
            targetKeyword: b.primary_keyword,
            status: b.status || "READY",
            date: new Date(b.created_at).toLocaleDateString(),
            createdAt: b.created_at,
        })
    }

    for (const r of aiReports) {
        deliverables.push({
            id: r.id,
            title: r.title || `${r.project.brand_name} AI Visibility Intelligence Report`,
            type: "AI_REPORT",
            clientName: r.project.brand_name,
            projectId: r.project.id,
            status: r.status || "COMPLETED",
            date: new Date(r.created_at).toLocaleDateString(),
            createdAt: r.created_at,
        })
    }

    for (const a of seoAudits) {
        deliverables.push({
            id: a.id,
            title: `SEO Technical & AI Readiness Audit (Score: ${a.overall_score}%)`,
            type: "SEO_AUDIT",
            clientName: a.project.brand_name,
            projectId: a.project.id,
            status: a.status || "COMPLETED",
            date: new Date(a.created_at).toLocaleDateString(),
            createdAt: a.created_at,
        })
    }

    deliverables.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    return deliverables
}

export async function updateClientSettings(
    agencyUserId: string,
    clientUserId: string,
    input: { category?: string; monthly_credit_cap?: number; assigned_manager_id?: string | null; role?: string }
) {
    await assertAgencyManager(agencyUserId)
    const updated = await prisma.agencyClientLink.updateMany({
        where: { agency_user_id: agencyUserId, client_user_id: clientUserId },
        data: {
            category: input.category !== undefined ? input.category.trim() : undefined,
            monthly_credit_cap: input.monthly_credit_cap !== undefined ? input.monthly_credit_cap : undefined,
            assigned_manager_id: input.assigned_manager_id !== undefined ? input.assigned_manager_id : undefined,
            role: input.role !== undefined ? input.role : undefined,
        },
    })
    if (!updated.count) throw Object.assign(new Error("Client link not found"), { status: 404 })
    return { agency_user_id: agencyUserId, client_user_id: clientUserId, ...input }
}

export async function listAgencyMembers(agencyUserId: string) {
    await requireAgencyOwner(agencyUserId)
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: agencyUserId }, select: { id: true, email: true } })
    const members = await prisma.agencyMembership.findMany({
        where: { agency_user_id: agencyUserId },
        orderBy: { created_at: "asc" },
        include: { member: { select: { id: true, email: true, is_verified: true } } },
    })
    return [{ id: owner.id, email: owner.email, role: AgencyMembershipRole.OWNER, status: "ACTIVE" }, ...members.map(m => ({ id: m.member_user_id, email: m.member.email, role: m.role, status: m.status }))]
}

export async function createAgencyInvitation(input: { actorUserId: string; email: string; type: AgencyInvitationType; role: AgencyMembershipRole; assignedProjectIds?: string[] }) {
    const context = await assertAgencyManager(input.actorUserId)
    if (input.type === AgencyInvitationType.TEAM_MEMBER && !STAFF_ROLES.has(input.role)) throw Object.assign(new Error("Invalid team role"), { status: 400 })
    if (input.type === AgencyInvitationType.CLIENT_USER && input.role !== AgencyMembershipRole.CLIENT_ADMIN && input.role !== AgencyMembershipRole.CLIENT_VIEWER) throw Object.assign(new Error("Invalid client role"), { status: 400 })

    const email = input.email.trim().toLowerCase()
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, account_type: true } })
    if (existing?.id === context.agency_user_id) throw Object.assign(new Error("You cannot invite yourself"), { status: 400 })
    if (input.type === AgencyInvitationType.TEAM_MEMBER && existing?.account_type === "AGENCY") throw Object.assign(new Error("Agency accounts cannot join another agency"), { status: 400 })

    await prisma.agencyInvitation.updateMany({ where: { agency_user_id: context.agency_user_id, email, status: AgencyInvitationStatus.PENDING }, data: { status: AgencyInvitationStatus.REVOKED } })
    const token = crypto.randomBytes(32).toString("hex")
    const invitation = await prisma.agencyInvitation.create({
        data: { agency_user_id: context.agency_user_id, invitee_user_id: existing?.id, email, type: input.type, role: input.role, token, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), assigned_project_ids: input.assignedProjectIds ?? [] },
        include: { agency: { select: { email: true } } },
    })
    const appUrl = process.env.FRONTEND_URL ?? "http://localhost:5173"
    try { await sendAgencyInvitationEmail(email, invitation.agency.email, `${appUrl}/agency/invitations/${token}`) } catch (error) {
        if (process.env.NODE_ENV === "production") throw error
        console.warn(`[DEV AGENCY INVITE] ${appUrl}/agency/invitations/${token}`)
    }
    return { id: invitation.id, email, type: input.type, role: input.role, expires_at: invitation.expires_at, invite_url: `${appUrl}/agency/invitations/${token}` }
}

export async function acceptAgencyInvitation(token: string, password?: string) {
    const invitation = await prisma.agencyInvitation.findUnique({ where: { token }, include: { agency: { select: { id: true, account_type: true } } } })
    if (!invitation || invitation.status !== AgencyInvitationStatus.PENDING || invitation.expires_at < new Date()) throw Object.assign(new Error("Invitation is invalid or expired"), { status: 400 })

    let user = invitation.invitee_user_id ? await prisma.user.findUnique({ where: { id: invitation.invitee_user_id } }) : await prisma.user.findUnique({ where: { email: invitation.email } })
    if (user?.account_type === "AGENCY") throw Object.assign(new Error("Agency accounts cannot be invited into another agency"), { status: 400 })
    if (!user) {
        if (!password || password.length < 8) throw Object.assign(new Error("A password of at least 8 characters is required"), { status: 400 })
        user = await prisma.user.create({ data: { email: invitation.email, password: await bcrypt.hash(password, 10), account_type: "SINGLE", is_verified: true, product_tour_completed: true } })
    }
    if (invitation.type === AgencyInvitationType.TEAM_MEMBER) {
        await prisma.agencyMembership.upsert({ where: { agency_user_id_member_user_id: { agency_user_id: invitation.agency_user_id, member_user_id: user.id } }, create: { agency_user_id: invitation.agency_user_id, member_user_id: user.id, role: invitation.role, status: AgencyMembershipStatus.ACTIVE }, update: { role: invitation.role, status: AgencyMembershipStatus.ACTIVE } })
    } else {
        await prisma.agencyClientLink.upsert({ where: { agency_user_id_client_user_id: { agency_user_id: invitation.agency_user_id, client_user_id: user.id } }, create: { agency_user_id: invitation.agency_user_id, client_user_id: user.id, role: invitation.role === AgencyMembershipRole.CLIENT_VIEWER ? "CLIENT_VIEWER" : "CLIENT_ADMIN", status: "ACTIVE", assigned_project_ids: invitation.assigned_project_ids }, update: { role: invitation.role === AgencyMembershipRole.CLIENT_VIEWER ? "CLIENT_VIEWER" : "CLIENT_ADMIN", status: "ACTIVE", assigned_project_ids: invitation.assigned_project_ids } })
    }
    await prisma.agencyInvitation.update({ where: { id: invitation.id }, data: { status: AgencyInvitationStatus.ACCEPTED, invitee_user_id: user.id } })
    const accessToken = generateAccessToken(user.id)
    const refreshToken = generateRefreshToken(user.id)
    return {
        user_id: user.id,
        email: user.email,
        type: invitation.type,
        role: invitation.role,
        agency_user_id: invitation.agency_user_id,
        access_token: accessToken,
        refresh_token: refreshToken,
        user: {
            id: user.id,
            email: user.email,
            account_type: user.account_type,
            role: user.role,
            plan: user.plan,
            is_verified: user.is_verified,
            credits_balance: user.credits_balance,
        },
    }
}

export async function addAgencyClient(agencyUserId: string, clientEmail: string) {
    const existing = await prisma.user.findUnique({ where: { email: clientEmail.trim().toLowerCase() }, select: { id: true, is_verified: true, account_type: true } })
    if (existing) {
        await assertAgencyManager(agencyUserId)
        if (!existing.is_verified) throw Object.assign(new Error("That user has not verified their email yet"), { status: 400 })
        if (existing.account_type === "AGENCY") throw Object.assign(new Error("Cannot link another agency account"), { status: 400 })
        return prisma.agencyClientLink.upsert({ where: { agency_user_id_client_user_id: { agency_user_id: agencyUserId, client_user_id: existing.id } }, create: { agency_user_id: agencyUserId, client_user_id: existing.id }, update: { status: "ACTIVE" } })
    }
    return createAgencyInvitation({ actorUserId: agencyUserId, email: clientEmail, type: AgencyInvitationType.CLIENT_USER, role: AgencyMembershipRole.CLIENT_ADMIN })
}

export async function updateClientLinkStatus(agencyUserId: string, clientUserId: string, status: "ACTIVE" | "SUSPENDED") {
    await assertAgencyManager(agencyUserId)
    const updated = await prisma.agencyClientLink.updateMany({ where: { agency_user_id: agencyUserId, client_user_id: clientUserId }, data: { status } })
    if (!updated.count) throw Object.assign(new Error("Client link not found"), { status: 404 })
    return { agency_user_id: agencyUserId, client_user_id: clientUserId, status }
}

export async function removeAgencyClient(agencyUserId: string, clientUserId: string) {
    await assertAgencyManager(agencyUserId)
    await prisma.agencyClientLink.deleteMany({ where: { agency_user_id: agencyUserId, client_user_id: clientUserId } })
    return { removed: true }
}

export async function getClientProjects(agencyUserId: string, clientUserId: string) {
    const context = await getAgencyContext(agencyUserId)
    if (!context || context.agency_user_id !== agencyUserId) throw Object.assign(new Error("Agency access required"), { status: 403 })
    const link = await prisma.agencyClientLink.findUnique({ where: { agency_user_id_client_user_id: { agency_user_id: agencyUserId, client_user_id: clientUserId } } })
    if (!link || link.status !== "ACTIVE") throw Object.assign(new Error("No active client link found"), { status: 404 })
    return prisma.project.findMany({ where: { user_id: clientUserId }, orderBy: { created_at: "asc" }, select: { id: true, brand_name: true, brand_url: true, brand_location: true, created_at: true, updated_at: true, _count: { select: { prompts: true, competitors: true, runs: true } } } })
}
