import { Router } from "express"
import { getUserProjectsController } from "./projects_controller"
import { updateProjectEnginesController } from "../project_engines/project_engines_controller"

const router = Router()

router.get("/", getUserProjectsController)
router.put("/:project_id/engines", updateProjectEnginesController)

export default router
