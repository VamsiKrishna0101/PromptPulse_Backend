import { Router } from "express"
import { requireAdmin, requireAuth } from "../../middleware/auth"
import { bookDemoController, getPendingDemosController } from "./demo_controller"

const router = Router()

router.post("/", bookDemoController)
router.get("/pending", requireAuth, requireAdmin, getPendingDemosController)

export default router
