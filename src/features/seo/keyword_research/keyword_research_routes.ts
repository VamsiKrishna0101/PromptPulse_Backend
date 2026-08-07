import { Router } from "express"
import {
    getKeywordResearchController,
    listKeywordResearchRunsController,
    refreshKeywordResearchController,
} from "./keyword_research_controller"

const router = Router()

router.get("/:projectId/runs", listKeywordResearchRunsController)
router.get("/:projectId/research", getKeywordResearchController)
router.post("/:projectId/research/refresh", refreshKeywordResearchController)

export default router
