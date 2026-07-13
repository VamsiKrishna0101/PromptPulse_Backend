import { Router } from "express"
import type { Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { completeProductTourController, getProductTourStatusController } from "./product_tour_controller"

const router = Router()

router.get("/status", (req, res) => getProductTourStatusController(req as AuthenticatedRequest, res as Response))
router.post("/complete", (req, res) => completeProductTourController(req as AuthenticatedRequest, res as Response))
router.post("/skip", (req, res) => completeProductTourController(req as AuthenticatedRequest, res as Response))

export default router
