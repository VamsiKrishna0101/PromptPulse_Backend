import { Router } from "express"
import {
    listRedditIntelligenceController,
    runRedditIntelligenceController,
} from "./reddit_intelligence_controller"

const router = Router()

router.get("/", listRedditIntelligenceController)
router.post("/run", runRedditIntelligenceController)

export default router
