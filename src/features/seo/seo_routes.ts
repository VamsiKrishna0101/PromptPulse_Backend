import { Router } from "express"
import { getLatestSeoAuditController, getSeoAuditController, listSeoAuditsController, runSeoAuditController } from "./seo_controller"

const router = Router()

router.get("/:project_id/latest", getLatestSeoAuditController)
router.get("/:project_id/history", listSeoAuditsController)
router.get("/:project_id/audit/:audit_id", getSeoAuditController)
router.post("/:project_id/run", runSeoAuditController)

export default router
