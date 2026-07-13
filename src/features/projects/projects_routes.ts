import { Router } from "express"
import { getUserProjectsController } from "./projects_controller"

const router = Router()

router.get("/", getUserProjectsController)

export default router
