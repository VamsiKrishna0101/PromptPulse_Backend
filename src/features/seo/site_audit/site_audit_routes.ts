import { Router } from "express"
import {
    deleteAuditController,
    getAuditHistoryController,
    getAuditResultsController,
    getAuditStatusController,
    startAuditController
} from "./site_audit_controller"

const router = Router()

router.post("/:projectId/start", startAuditController)
router.get("/:projectId/history", getAuditHistoryController)
router.get("/:projectId/:auditId/status", getAuditStatusController)
router.get("/:projectId/:auditId/results", getAuditResultsController)
router.delete("/:projectId/:auditId", deleteAuditController)

export default router
