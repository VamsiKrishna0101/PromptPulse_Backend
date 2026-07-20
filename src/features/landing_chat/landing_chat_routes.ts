import { Router } from "express"
import { answerLandingChatController, createLandingLeadController } from "./landing_chat_controller"
import { landingChatRateLimit } from "./landing_chat_rate_limit"

const router = Router()

router.use(landingChatRateLimit)
router.post("/message", answerLandingChatController)
router.post("/lead", createLandingLeadController)

export default router
