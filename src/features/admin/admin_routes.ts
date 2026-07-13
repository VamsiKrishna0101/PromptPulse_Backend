import { Router } from "express"
import {
    getAdminOverviewController,
    getAdminUserController,
    listAdminProjectsController,
    listAdminSubscriptionsController,
    listAdminTicketsController,
    listAdminUsersController,
    setAdminTicketResolvedController,
} from "./admin_controller"

const router = Router()

router.get("/overview", getAdminOverviewController)
router.get("/users", listAdminUsersController)
router.get("/users/:user_id", getAdminUserController)
router.get("/projects", listAdminProjectsController)
router.get("/subscriptions", listAdminSubscriptionsController)
router.get("/tickets", listAdminTicketsController)
router.patch("/tickets/:ticket_id/resolve", setAdminTicketResolvedController)

export default router
