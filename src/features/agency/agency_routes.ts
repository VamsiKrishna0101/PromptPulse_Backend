import { Router } from "express"
import {
    listClientsController,
    addClientController,
    updateClientStatusController,
    removeClientController,
    getClientProjectsController,
    listMembersController,
    createInvitationController,
} from "./agency_controller"

const router = Router()

// List all linked client accounts
router.get("/clients", listClientsController)
router.get("/members", listMembersController)
router.post("/invitations", createInvitationController)

// Add a new client by email
router.post("/clients", addClientController)

// Get a specific client's projects
router.get("/clients/:client_user_id/projects", getClientProjectsController)

// Suspend or reactivate a client link
router.patch("/clients/:client_user_id", updateClientStatusController)

// Remove a client link entirely
router.delete("/clients/:client_user_id", removeClientController)

export default router
