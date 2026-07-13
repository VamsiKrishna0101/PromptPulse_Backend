import { Router } from "express"
import { getSettingsController, updatePasswordController } from "./settings_controller"

const router = Router()

router.get("/", getSettingsController)
router.get("/me", getSettingsController)
router.patch("/password", updatePasswordController)

export default router
