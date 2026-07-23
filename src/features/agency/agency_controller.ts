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
} from "./agency_service"

// ─── Guard helper ─────────────────────────────────────────────────────────────

function requireAgencyUser(req: Request, res: Response): string | null {
    const user = (req as AuthenticatedRequest).user
    if (user.account_type !== "AGENCY") {
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

// ─── Controllers ──────────────────────────────────────────────────────────────

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
    try { res.json({ members: await listAgencyMembers(agency_user_id) }) }
    catch (error) { handleError(error, res, "Failed to list agency members") }
}

/** POST /api/agency/invitations */
export async function createInvitationController(req: Request, res: Response): Promise<void> {
    const actorUserId = (req as AuthenticatedRequest).user?.id
    const email = typeof req.body.email === "string" ? req.body.email : ""
    const type = req.body.type === "CLIENT_USER" ? AgencyInvitationType.CLIENT_USER : AgencyInvitationType.TEAM_MEMBER
    const role = typeof req.body.role === "string" && Object.values(AgencyMembershipRole).includes(req.body.role) ? req.body.role as AgencyMembershipRole : AgencyMembershipRole.ANALYST
    if (!actorUserId || !email.trim()) { res.status(400).json({ error: "email is required" }); return }
    try { res.status(201).json({ success: true, invitation: await createAgencyInvitation({ actorUserId, email, type, role }) }) }
    catch (error) { handleError(error, res, "Failed to create invitation") }
}

/** POST /api/agency/invitations/accept */
export async function acceptInvitationController(req: Request, res: Response): Promise<void> {
    const token = typeof req.body.token === "string" ? req.body.token : ""
    const password = typeof req.body.password === "string" ? req.body.password : undefined
    if (!token) { res.status(400).json({ error: "token is required" }); return }
    try { res.json({ success: true, invitation: await acceptAgencyInvitation(token, password) }) }
    catch (error) { handleError(error, res, "Failed to accept invitation") }
}

/** POST /api/agency/clients
 *  Body: { email: string }
 */
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

/** PATCH /api/agency/clients/:client_user_id
 *  Body: { status: "ACTIVE" | "SUSPENDED" }
 */
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
