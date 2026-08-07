import { Router } from "express"
import {
    backlinksOverviewController,
    backlinksPageController,
    backlinksReportController,
    backlinksReportsController,
} from "./backlinks_controller"

const router = Router()

router.get("/:projectId/reports", backlinksReportsController)
router.get("/:projectId/report", backlinksReportController)
router.post("/:projectId/report/refresh", backlinksReportController)

router.get("/:projectId/overview", backlinksOverviewController)
router.post("/:projectId/overview/refresh", backlinksOverviewController)
router.get("/:projectId/backlinks", backlinksPageController("backlinks"))
router.post("/:projectId/backlinks/refresh", backlinksPageController("backlinks"))
router.get("/:projectId/referring-domains", backlinksPageController("domains"))
router.post("/:projectId/referring-domains/refresh", backlinksPageController("domains"))
router.get("/:projectId/top-pages", backlinksPageController("pages"))
router.post("/:projectId/top-pages/refresh", backlinksPageController("pages"))

export default router
