import { Router } from "express"
import { createTicketController, getTicketsController } from "./help_controller"

const router = Router()

router.post("/tickets", createTicketController)
router.get("/tickets", getTicketsController)

export default router
