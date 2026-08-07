import { Router } from "express"
import { requireAuth } from "../../middleware/auth"
import {
    getPortfolioController,
    listClientsController,
    listMembersController,
    createInvitationController,
    acceptInvitationController,
    addClientController,
    updateClientStatusController,
    updateClientSettingsController,
    removeClientController,
    getClientProjectsController,
    getBrandingController,
    updateBrandingController,
    createPortalShareController,
    listPortalSharesController,
    revokePortalShareController,
    getPublicPortalController,
    unlockPublicPortalController,
    listDeliverablesController,
} from "./agency_controller"

const router = Router()

// ─── Public Live Portal Endpoints ─────────────────────────────────────────────
router.get("/portal/live/:token", getPublicPortalController)
router.post("/portal/live/:token/unlock", unlockPublicPortalController)

// Accept Invitation (Public with token)
router.post("/invitations/accept", acceptInvitationController)

// ─── Authenticated Agency Routes ──────────────────────────────────────────────
router.use(requireAuth)

// Master Portfolio Overview
router.get("/portfolio", getPortfolioController)

// Team Members & Invitations
router.get("/members", listMembersController)
router.post("/invitations", createInvitationController)

// Client Accounts Management
router.get("/clients", listClientsController)
router.post("/clients", addClientController)
router.get("/clients/:client_user_id/projects", getClientProjectsController)
router.patch("/clients/:client_user_id", updateClientStatusController)
router.patch("/clients/:client_user_id/settings", updateClientSettingsController)
router.delete("/clients/:client_user_id", removeClientController)

// White-Label Branding Settings
router.get("/branding", getBrandingController)
router.put("/branding", updateBrandingController)

// Deliverables & Sign-offs
router.get("/deliverables", listDeliverablesController)

// Shareable Portal Links
router.get("/portal-shares", listPortalSharesController)
router.post("/portal-shares", createPortalShareController)
router.delete("/portal-shares/:token", revokePortalShareController)

export default router

