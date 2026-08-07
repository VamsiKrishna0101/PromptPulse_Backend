import { Router } from "express"
import {
    getAccountController,
    connectAccountController,
    connectTestAccountController,
    updateAccountProfileController,
    uploadProfilePicController,
    syncAccountController,
    accountHealthController,
    disconnectAccountController,
    listTemplatesController,
    syncTemplatesController,
    createTemplateController,
    listCampaignsController,
    getCampaignController,
    createCampaignController,
    launchCampaignController,
    pauseCampaignController,
    deleteCampaignController,
    listRecipientsController,
    costEstimateController,
    getBotConfigController,
    updateBotConfigController,
    getLeadsController,
    updateLeadController,
    deleteLeadController,
} from "./whatsapp_controller"

const router = Router()

// ─── Webhook (public — no auth, Meta calls this) ─────────────────────────────

// ─── Account ──────────────────────────────────────────────────────────────────
router.get("/account", getAccountController)
router.post("/account", connectAccountController)
router.post("/account/test", connectTestAccountController)
router.patch("/account/:accountId", updateAccountProfileController)
router.post("/account/:accountId/upload-profile-pic", uploadProfilePicController)
router.post("/account/:accountId/sync", syncAccountController)
router.get("/account/:accountId/health", accountHealthController)
router.delete("/account/:accountId", disconnectAccountController)

// ─── Templates ────────────────────────────────────────────────────────────────
router.get("/templates", listTemplatesController)
router.post("/templates/sync", syncTemplatesController)
router.post("/templates", createTemplateController)

// ─── Campaigns ────────────────────────────────────────────────────────────────
router.get("/", listCampaignsController)
router.get("/:campaignId", getCampaignController)
router.post("/", createCampaignController)
router.post("/:campaignId/launch", launchCampaignController)
router.patch("/:campaignId/pause", pauseCampaignController)
router.delete("/:campaignId", deleteCampaignController)
router.get("/:campaignId/recipients", listRecipientsController)

// ─── Bot & Dynamic Catalog & Leads ───────────────────────────────────────────
router.get("/bot-config", getBotConfigController)
router.put("/bot-config", updateBotConfigController)
router.get("/leads", getLeadsController)
router.patch("/leads/:id", updateLeadController)
router.delete("/leads/:id", deleteLeadController)

// ─── Utilities ────────────────────────────────────────────────────────────────
router.post("/cost-estimate", costEstimateController)

export default router
