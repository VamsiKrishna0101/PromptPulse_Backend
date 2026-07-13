import { Router } from "express"
import { getProfileController } from "./profile_controller"

const router = Router()

router.get("/", getProfileController)
router.get("/me", getProfileController)

export default router
