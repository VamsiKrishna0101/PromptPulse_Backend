import { Router } from "express"
import { getOpportunitiesController } from "./opportunity_controller"

const router = Router()

router.get("/:project_id", getOpportunitiesController)

export default router
