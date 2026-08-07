import { Request, Response } from "express"
import { AgencyInvitationType, AgencyMembershipRole } from "@prisma/client"
import type { AuthenticatedRequest } from "../../middleware/auth"
import {
    listAgencyClients,
    addAgencyClient,
    updateClientLinkStatus,
    removeAgencyClient,
    getClientProjects,
    listAgencyMembers,
    createAgencyInvitation,
    acceptAgencyInvitation,
    getAgencyPortfolio,
    updateClientSettings,
    listAgencyDeliverables,
} from "./agency_service"
import {
    getAgencyBranding,
    upsertAgencyBranding,
} from "./agency_branding_service"
import {
    createPortalShare,
    listProjectPortalShares,
    revokePortalShare,
    getPublicPortalData,
} from "./agency_portal_service"

// ─── Guard helper ─────────────────────────────────────────────────────────────

function requireAgencyUser(req: Request, res: Response): string | null {
    const user = (req as AuthenticatedRequest).user
    if (!user || user.account_type !== "AGENCY") {
        res.status(403).json({ error: "Agency account required" })
        return null
    }
    return user.id
}

function handleError(error: unknown, res: Response, fallback: string) {
    const status = typeof error === "object" && error && "status" in error
        ? Number((error as { status?: unknown }).status)
        : 500
    const message = error instanceof Error ? error.message : fallback
    res.status(Number.isFinite(status) && status >= 400 ? status : 500).json({ error: message })
}

// ─── Portfolio & Clients ──────────────────────────────────────────────────────

/** GET /api/agency/portfolio */
export async function getPortfolioController(req: Request, res: Response): Promise<void> {
    const agency_user_id = requireAgencyUser(req, res)
    if (!agency_user_id) return

    try {
        const portfolio = await getAgencyPortfolio(agency_user_id)
        res.json(portfolio)
    } catch (error) {
        handleError(error, res, "Failed to load agency portfolio")
    }
}

/** GET /api/agency/clients */
export async function listClientsController(req: Request, res: Response): Promise<void> {
    const agency_user_id = requireAgencyUser(req, res)
    if (!agency_user_id) return

    try {
        const clients = await listAgencyClients(agency_user_id)
        res.json({ clients })
    } catch (error) {
        handleError(error, res, "Failed to list agency clients")
    }
}

/** GET /api/agency/members */
export async function listMembersController(req: Request, res: Response): Promise<void> {
    const agency_user_id = requireAgencyUser(req, res)
    if (!agency_user_id) return
    try {
        res.json({ members: await listAgencyMembers(agency_user_id) })
    } catch (error) {
        handleError(error, res, "Failed to list agency members")
    }
}

/** POST /api/agency/invitations */
export async function createInvitationController(req: Request, res: Response): Promise<void> {
    const actorUserId = (req as AuthenticatedRequest).user?.id
    const email = typeof req.body.email === "string" ? req.body.email : ""
    const type = req.body.type === "CLIENT_USER" ? AgencyInvitationType.CLIENT_USER : AgencyInvitationType.TEAM_MEMBER
    const role = typeof req.body.role === "string" && Object.values(AgencyMembershipRole).includes(req.body.role)
        ? req.body.role as AgencyMembershipRole
        : AgencyMembershipRole.ANALYST
    const assignedProjectIds = Array.isArray(req.body.assigned_project_ids)
        ? req.body.assigned_project_ids.map(String)
        : []
    if (!actorUserId || !email.trim()) {
        res.status(400).json({ error: "email is required" })
        return
    }
    try {
        res.status(201).json({
            success: true,
            invitation: await createAgencyInvitation({ actorUserId, email, type, role, assignedProjectIds }),
        })
    } catch (error) {
        handleError(error, res, "Failed to create invitation")
    }
}

/** POST /api/agency/invitations/accept */
export async function acceptInvitationController(req: Request, res: Response): Promise<void> {
    const token = typeof req.body.token === "string" ? req.body.token : ""
    const password = typeof req.body.password === "string" ? req.body.password : undefined
    if (!token) {
        res.status(400).json({ error: "token is required" })
        return
    }
    try {
        res.json({ success: true, invitation: await acceptAgencyInvitation(token, password) })
    } catch (error) {
        handleError(error, res, "Failed to accept invitation")
    }
}

/** POST /api/agency/clients */
export async function addClientController(req: Request, res: Response): Promise<void> {
    const agency_user_id = requireAgencyUser(req, res)
    if (!agency_user_id) return

    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : ""
    if (!email) {
        res.status(400).json({ error: "email is required" })
        return
    }

    try {
        const result = await addAgencyClient(agency_user_id, email)
        res.status(201).json({ success: true, ...result })
    } catch (error) {
        handleError(error, res, "Failed to add client")
    }
}

/** PATCH /api/agency/clients/:client_user_id */
export async function updateClientStatusController(req: Request, res: Response): Promise<void> {
    const agency_user_id = requireAgencyUser(req, res)
    if (!agency_user_id) return

    const client_user_id = String(req.params.client_user_id)
    const status = req.body.status

    if (status !== "ACTIVE" && status !== "SUSPENDED") {
        res.status(400).json({ error: "status must be ACTIVE or SUSPENDED" })
        return
    }

    try {
        const result = await updateClientLinkStatus(agency_user_id, client_user_id, status)
        res.json({ success: true, ...result })
    } catch (error) {
        handleError(error, res, "Failed to update client status")
    }
}

/** PATCH /api/agency/clients/:client_user_id/settings */
export async function updateClientSettingsController(req: Request, res: Response): Promise<void> {
    const agency_user_id = requireAgencyUser(req, res)
    if (!agency_user_id) return

    const client_user_id = String(req.params.client_user_id)
    const { category, monthly_credit_cap, assigned_manager_id, role } = req.body

    try {
        const result = await updateClientSettings(agency_user_id, client_user_id, {
            category,
            monthly_credit_cap: typeof monthly_credit_cap === "number" ? monthly_credit_cap : undefined,
            assigned_manager_id,
            role,
        })
        res.json({ success: true, ...result })
    } catch (error) {
        handleError(error, res, "Failed to update client settings")
    }
}

/** DELETE /api/agency/clients/:client_user_id */
export async function removeClientController(req: Request, res: Response): Promise<void> {
    const agency_user_id = requireAgencyUser(req, res)
    if (!agency_user_id) return

    const client_user_id = String(req.params.client_user_id)

    try {
        await removeAgencyClient(agency_user_id, client_user_id)
        res.json({ success: true })
    } catch (error) {
        handleError(error, res, "Failed to remove client")
    }
}

/** GET /api/agency/clients/:client_user_id/projects */
export async function getClientProjectsController(req: Request, res: Response): Promise<void> {
    const agency_user_id = requireAgencyUser(req, res)
    if (!agency_user_id) return

    const client_user_id = String(req.params.client_user_id)

    try {
        const projects = await getClientProjects(agency_user_id, client_user_id)
        res.json({ projects })
    } catch (error) {
        handleError(error, res, "Failed to get client projects")
    }
}

// ─── Branding & White-Label ───────────────────────────────────────────────────

/** GET /api/agency/branding */
export async function getBrandingController(req: Request, res: Response): Promise<void> {
    const userId = (req as AuthenticatedRequest).user?.id
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
    }

    try {
        const branding = await getAgencyBranding(userId)
        res.json(branding)
    } catch (error) {
        handleError(error, res, "Failed to fetch agency branding")
    }
}

/** PUT /api/agency/branding */
export async function updateBrandingController(req: Request, res: Response): Promise<void> {
    const userId = (req as AuthenticatedRequest).user?.id
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
    }

    try {
        const updated = await upsertAgencyBranding(userId, req.body)
        res.json({ success: true, branding: updated })
    } catch (error) {
        handleError(error, res, "Failed to update agency branding")
    }
}

// ─── Shareable Portal Links ───────────────────────────────────────────────────

/** POST /api/agency/portal-shares */
export async function createPortalShareController(req: Request, res: Response): Promise<void> {
    const userId = (req as AuthenticatedRequest).user?.id
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
    }

    const { projectId, title, passcode, expiresDays, allowedTabs } = req.body
    if (!projectId) {
        res.status(400).json({ error: "projectId is required" })
        return
    }

    try {
        const share = await createPortalShare({
            actorUserId: userId,
            projectId,
            title,
            passcode,
            expiresDays: typeof expiresDays === "number" ? expiresDays : undefined,
            allowedTabs: Array.isArray(allowedTabs) ? allowedTabs : undefined,
        })
        res.status(201).json({ success: true, share })
    } catch (error) {
        handleError(error, res, "Failed to create share link")
    }
}

/** GET /api/agency/portal-shares */
export async function listPortalSharesController(req: Request, res: Response): Promise<void> {
    const userId = (req as AuthenticatedRequest).user?.id
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
    }

    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined

    try {
        const shares = await listProjectPortalShares(userId, projectId)
        res.json({ shares })
    } catch (error) {
        handleError(error, res, "Failed to list share links")
    }
}

/** DELETE /api/agency/portal-shares/:token */
export async function revokePortalShareController(req: Request, res: Response): Promise<void> {
    const userId = (req as AuthenticatedRequest).user?.id
    if (!userId) {
        res.status(401).json({ error: "Unauthorized" })
        return
    }

    const token = String(req.params.token)

    try {
        const result = await revokePortalShare(userId, token)
        res.json({ success: true, ...result })
    } catch (error) {
        handleError(error, res, "Failed to revoke share link")
    }
}

/** GET /api/agency/portal/live/:token (Public) */
export async function getPublicPortalController(req: Request, res: Response): Promise<void> {
    const token = String(req.params.token)
    const passcode = typeof req.query.passcode === "string" ? req.query.passcode : undefined

    try {
        const data = await getPublicPortalData(token, passcode)
        res.json(data)
    } catch (error) {
        handleError(error, res, "Failed to load client portal")
    }
}

/** POST /api/agency/portal/live/:token/unlock (Public Passcode Submit) */
export async function unlockPublicPortalController(req: Request, res: Response): Promise<void> {
    const token = String(req.params.token)
    const passcode = typeof req.body.passcode === "string" ? req.body.passcode : ""

    try {
        const data = await getPublicPortalData(token, passcode)
        res.json(data)
    } catch (error) {
        handleError(error, res, "Invalid passcode")
    }
}

/** GET /api/agency/deliverables */
export async function listDeliverablesController(req: Request, res: Response): Promise<void> {
    const agency_user_id = requireAgencyUser(req, res)
    if (!agency_user_id) return

    const projectId = typeof req.query.project_id === "string" ? req.query.project_id : undefined

    try {
        const deliverables = await listAgencyDeliverables(agency_user_id, projectId)
        res.json({ deliverables })
    } catch (error) {
        handleError(error, res, "Failed to list agency deliverables")
    }
}

