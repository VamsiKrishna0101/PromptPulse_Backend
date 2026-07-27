import { Router } from "express"
import { createOpportunityActionController, getOpportunitiesController } from "./opportunity_controller"

const router = Router()

router.get("/:project_id", getOpportunitiesController)
router.post("/:project_id/:opportunity_id/actions", createOpportunityActionController)

export default router
