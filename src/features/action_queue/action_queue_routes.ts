import { Router } from "express"
import {
    generateActionQueueController,
    listActionQueueController,
    updateActionQueueController,
} from "./action_queue_controller"

const router = Router()

router.get("/", listActionQueueController)
router.post("/generate", generateActionQueueController)
router.patch("/:item_id", updateActionQueueController)

export default router
