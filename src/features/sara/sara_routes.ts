import { Router } from "express"
import {
    chatWithSaraController,
    chatWithSaraStreamController,
    getSaraConversationsController,
    getSaraMessagesController,
    getSaraReadinessController,
    reindexSaraProjectController,
    searchSaraProjectController
} from "./sara_controller"

const router = Router()

router.post("/:project_id/reindex", reindexSaraProjectController)
router.post("/:project_id/search", searchSaraProjectController)
router.post("/:project_id/chat", chatWithSaraController)
router.post("/:project_id/chat/stream", chatWithSaraStreamController)
router.get("/:project_id/readiness", getSaraReadinessController)
router.get("/:project_id/conversations", getSaraConversationsController)
router.get("/:project_id/conversations/:conversation_id/messages", getSaraMessagesController)

export default router
