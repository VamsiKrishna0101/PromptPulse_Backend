import { Router } from "express"
import * as controller from "./email_campaign_controller"

const router = Router()

router.post("/account", controller.createAccount)
router.get("/account", controller.getAccount)

router.post("/templates", controller.createTemplate)
router.get("/templates", controller.listTemplates)

router.post("/create", controller.createCampaign)
router.get("/list", controller.listCampaigns)
router.get("/:id", controller.getCampaign)
router.post("/:id/recipients/upload", controller.uploadRecipients)
router.post("/:id/launch", controller.launchCampaign)

export default router
