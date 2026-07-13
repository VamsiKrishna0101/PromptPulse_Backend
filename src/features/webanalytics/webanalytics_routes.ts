import { Router } from "express"
import { requireAuth } from "../../middleware/auth"
import {
    collectAnalyticsActionController,
    collectAnalyticsEventController,
    createAnalyticsSiteController,
    createCustomEventController,
    deleteAnalyticsSiteController,
    deleteCustomEventController,
    getAnalyticsBreakdownController,
    getAnalyticsDurationsController,
    getAnalyticsEventsController,
    getAnalyticsFactsController,
    getAnalyticsPagesController,
    getAnalyticsReferrersController,
    getAnalyticsSummaryController,
    getAnalyticsTimeseriesController,
    getCustomEventStatsController,
    getTrackerScriptController,
    listAnalyticsSitesController,
    listCustomEventsController,
    regenerateAnalyticsSiteKeyController,
    updateAnalyticsSiteController,
    updateCustomEventController,
} from "./webanalytics_controller"

const router = Router()

router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
    next()
})

router.get("/tracker.js", getTrackerScriptController)
router.post("/collect", collectAnalyticsEventController)
router.post("/actions", collectAnalyticsActionController)

router.get("/:project_id/sites", requireAuth, listAnalyticsSitesController)
router.post("/:project_id/sites", requireAuth, createAnalyticsSiteController)
router.patch("/:project_id/sites/:site_id", requireAuth, updateAnalyticsSiteController)
router.delete("/:project_id/sites/:site_id", requireAuth, deleteAnalyticsSiteController)
router.post("/:project_id/sites/:site_id/regenerate-key", requireAuth, regenerateAnalyticsSiteKeyController)
router.get("/:project_id/summary", requireAuth, getAnalyticsSummaryController)
router.get("/:project_id/facts", requireAuth, getAnalyticsFactsController)
router.get("/:project_id/timeseries", requireAuth, getAnalyticsTimeseriesController)
router.get("/:project_id/pages", requireAuth, getAnalyticsPagesController)
router.get("/:project_id/referrers", requireAuth, getAnalyticsReferrersController)
router.get("/:project_id/durations", requireAuth, getAnalyticsDurationsController)
router.get("/:project_id/breakdowns/:dimension", requireAuth, getAnalyticsBreakdownController)
router.get("/:project_id/events", requireAuth, getAnalyticsEventsController)
router.get("/:project_id/sites/:site_id/custom-events", requireAuth, listCustomEventsController)
router.post("/:project_id/sites/:site_id/custom-events", requireAuth, createCustomEventController)
router.patch("/:project_id/sites/:site_id/custom-events/:event_id", requireAuth, updateCustomEventController)
router.delete("/:project_id/sites/:site_id/custom-events/:event_id", requireAuth, deleteCustomEventController)
router.get("/:project_id/sites/:site_id/custom-events/:event_id/stats", requireAuth, getCustomEventStatsController)

export default router
