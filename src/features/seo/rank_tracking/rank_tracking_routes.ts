import { Router } from "express"
import {
    addKeywordsController,
    createConfigController,
    estimateRunController,
    keywordHistoryController,
    keywordsController,
    latestResultsController,
    listConfigsController,
    positionMatrixController,
    removeKeywordsController,
    runCheckController,
    updateConfigController,
} from "./rank_tracking_controller"

const router = Router()

router.get("/:projectId/configs", listConfigsController)
router.post("/:projectId/configs", createConfigController)
router.patch("/:projectId/configs/:configId", updateConfigController)
router.get("/:projectId/configs/:configId/keywords", keywordsController)
router.post("/:projectId/configs/:configId/keywords", addKeywordsController)
router.delete("/:projectId/configs/:configId/keywords", removeKeywordsController)
router.get("/:projectId/configs/:configId/estimate", estimateRunController)
router.post("/:projectId/configs/:configId/runs", runCheckController)
router.get("/:projectId/configs/:configId/results/latest", latestResultsController)
router.get(
    "/:projectId/configs/:configId/keywords/:keywordId/history",
    keywordHistoryController,
)
router.get("/:projectId/configs/:configId/position-matrix", positionMatrixController)

export default router
