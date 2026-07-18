import { Router } from "express"
import { getBrandPreferenceController, upsertBrandPreferenceController } from "./brand_preferences_controller"

const router = Router()

router.get("/:projectId", getBrandPreferenceController)
router.put("/:projectId", upsertBrandPreferenceController)

export default router
