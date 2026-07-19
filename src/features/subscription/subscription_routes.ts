import { Router } from "express"
import {
    canAddCompetitorController,
    canCreateProjectController,
    canCreatePromptController,
    canExportController,
    canRunRefreshController,
    canUseSaraController,
    createSubscriptionController,
    getMyPlanController,
    getPlanLimitsController,
    getPlanQuotaController,
    refreshPlanUsageController,
    createBillingPortalController,
    verifyCheckoutController,
    listBillingInvoicesController,
} from "./subscription_controller"

const router = Router()

router.post("/create", createSubscriptionController)
router.post("/portal", createBillingPortalController)
router.get("/checkout/:sessionId", verifyCheckoutController)
router.get("/invoices", listBillingInvoicesController)
router.get("/me", getMyPlanController)
router.get("/limits", getPlanLimitsController)
router.get("/quota", getPlanQuotaController)
router.get("/can/create-project", canCreateProjectController)
router.get("/can/create-prompt", canCreatePromptController)
router.get("/can/add-competitor", canAddCompetitorController)
router.get("/can/run-refresh", canRunRefreshController)
router.get("/can/use-sara", canUseSaraController)
router.get("/can/export", canExportController)
router.post("/usage/refresh", refreshPlanUsageController)

export default router
