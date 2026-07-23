import bcrypt from "bcryptjs"
import crypto from "crypto"
import { AgencyInvitationStatus, AgencyInvitationType, AgencyMembershipRole, AgencyMembershipStatus } from "@prisma/client"
import prisma from "../../lib/prisma"
import { sendAgencyInvitationEmail } from "../email/email_service"

export type AgencyClientSummary = {
    link_id: string
    client_user_id: string
    client_email: string
    role: string
    status: string
    linked_at: Date
    project_count: number
}

const STAFF_ROLES = new Set<AgencyMembershipRole>([AgencyMembershipRole.ADMIN, AgencyMembershipRole.MANAGER, AgencyMembershipRole.ANALYST])

function agencyRoleCanManage(role: AgencyMembershipRole) {
    return role === AgencyMembershipRole.OWNER || role === AgencyMembershipRole.ADMIN
}

async function requireAgencyOwner(agencyUserId: string) {
    const user = await prisma.user.findUnique({ where: { id: agencyUserId }, select: { id: true, email: true, account_type: true } })
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
    await requireAgencyOwner(agencyUserId)
    const links = await prisma.agencyClientLink.findMany({
        where: { agency_user_id: agencyUserId },
        orderBy: { created_at: "desc" },
        include: { client: { select: { id: true, email: true, _count: { select: { projects: true } } } } },
    })
    return links.map(link => ({
        link_id: link.id,
        client_user_id: link.client_user_id,
        client_email: link.client.email,
        role: link.role,
        status: link.status,
        linked_at: link.created_at,
        project_count: link.client._count.projects,
    }))
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

export async function createAgencyInvitation(input: { actorUserId: string; email: string; type: AgencyInvitationType; role: AgencyMembershipRole }) {
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
        data: { agency_user_id: context.agency_user_id, invitee_user_id: existing?.id, email, type: input.type, role: input.role, token, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
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
        user = await prisma.user.create({ data: { email: invitation.email, password: await bcrypt.hash(password, 10), account_type: "SINGLE", is_verified: true } })
    }
    if (invitation.type === AgencyInvitationType.TEAM_MEMBER) {
        await prisma.agencyMembership.upsert({ where: { agency_user_id_member_user_id: { agency_user_id: invitation.agency_user_id, member_user_id: user.id } }, create: { agency_user_id: invitation.agency_user_id, member_user_id: user.id, role: invitation.role, status: AgencyMembershipStatus.ACTIVE }, update: { role: invitation.role, status: AgencyMembershipStatus.ACTIVE } })
    } else {
        await prisma.agencyClientLink.upsert({ where: { agency_user_id_client_user_id: { agency_user_id: invitation.agency_user_id, client_user_id: user.id } }, create: { agency_user_id: invitation.agency_user_id, client_user_id: user.id, role: invitation.role === AgencyMembershipRole.CLIENT_VIEWER ? "CLIENT_VIEWER" : "CLIENT_ADMIN", status: "ACTIVE" }, update: { role: invitation.role === AgencyMembershipRole.CLIENT_VIEWER ? "CLIENT_VIEWER" : "CLIENT_ADMIN", status: "ACTIVE" } })
    }
    await prisma.agencyInvitation.update({ where: { id: invitation.id }, data: { status: AgencyInvitationStatus.ACCEPTED, invitee_user_id: user.id } })
    return { user_id: user.id, email: user.email, type: invitation.type, role: invitation.role, agency_user_id: invitation.agency_user_id }
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
