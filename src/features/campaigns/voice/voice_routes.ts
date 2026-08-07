import { Router } from "express"
import {
    getVoiceAccountController,
    getPlaybooksController,
    updateVoiceAgentController,
    synthesizeVoicePreviewController,
    parseCsvController,
    createVoiceCampaignController,
    listVoiceCampaignsController,
    getVoiceCampaignController,
    listVoiceRecordsController,
    launchCampaignController,
    processBatchController,
} from "./voice_controller"

const router = Router()

// Account & Voice Agent Persona
router.get("/account", getVoiceAccountController)
router.get("/playbooks", getPlaybooksController)
router.put("/agent", updateVoiceAgentController)
router.post("/synthesize-preview", synthesizeVoicePreviewController)
router.post("/parse-csv", parseCsvController)

// Campaigns & Live Desk Records
router.get("/campaigns", listVoiceCampaignsController)
router.post("/campaigns", createVoiceCampaignController)
router.get("/campaigns/:id", getVoiceCampaignController)
router.get("/campaigns/:id/records", listVoiceRecordsController)
router.post("/campaigns/:id/launch", launchCampaignController)
router.post("/campaigns/:id/process-batch", processBatchController)

export default router
