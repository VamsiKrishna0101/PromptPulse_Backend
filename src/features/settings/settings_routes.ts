import { Router } from "express"
import { getSettingsController, updateAccountTypeController, updatePasswordController } from "./settings_controller"

const router = Router()

router.get("/", getSettingsController)
router.get("/me", getSettingsController)
router.patch("/password", updatePasswordController)
router.patch("/account-type", updateAccountTypeController)

export default router
