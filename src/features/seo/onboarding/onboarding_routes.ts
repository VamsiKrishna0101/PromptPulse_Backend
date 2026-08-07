import { Router } from "express"
import {
    approveRecommendationController,
    getLatestOnboardingController,
    getOnboardingController,
    rejectRecommendationController,
    retryOnboardingController,
    startOnboardingController,
} from "./onboarding_controller"

const router = Router()

router.post("/:projectId/start", startOnboardingController)
router.get("/:projectId/latest", getLatestOnboardingController)
router.get("/runs/:runId", getOnboardingController)
router.post("/runs/:runId/retry", retryOnboardingController)
router.post("/recommendations/:recommendationId/approve", approveRecommendationController)
router.post("/recommendations/:recommendationId/reject", rejectRecommendationController)

export default router
