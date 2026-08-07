import { Router } from "express"
import {
    getCompetitorsController,
    getKeywordGapController,
    getLocationsController,
    getOrganicKeywordsController,
    getOverviewController,
    getSiteStructureController,
    getTopPagesController,
    listSnapshotsController,
    refreshCompetitorsController,
    refreshKeywordGapController,
    refreshOrganicKeywordsController,
    refreshOverviewController,
    refreshTopPagesController,
} from "./domain_research_controller"

const router = Router()

router.get("/locations", getLocationsController)
router.get("/:projectId/snapshots", listSnapshotsController)

router.get("/:projectId/overview", getOverviewController)
router.post("/:projectId/overview/refresh", refreshOverviewController)

router.get("/:projectId/organic-keywords", getOrganicKeywordsController)
router.post("/:projectId/organic-keywords/refresh", refreshOrganicKeywordsController)

router.get("/:projectId/top-pages", getTopPagesController)
router.post("/:projectId/top-pages/refresh", refreshTopPagesController)

router.get("/:projectId/competitors", getCompetitorsController)
router.post("/:projectId/competitors/refresh", refreshCompetitorsController)

router.get("/:projectId/keyword-gap", getKeywordGapController)
router.post("/:projectId/keyword-gap/refresh", refreshKeywordGapController)

router.get("/:projectId/site-structure", getSiteStructureController)

export default router
