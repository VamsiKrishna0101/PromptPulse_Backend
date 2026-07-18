import { Router } from "express"
import { getChatArtifactUrlController } from "./artifact_controller"

const router = Router()

router.get("/chats/:chat_id/screenshot-url", getChatArtifactUrlController)

export default router
