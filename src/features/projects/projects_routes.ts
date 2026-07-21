import { Router } from "express"
import { getUserProjectsController } from "./projects_controller"
import { getProjectEnginesController, updateProjectEnginesController } from "../project_engines/project_engines_controller"

const router = Router()

router.get("/", getUserProjectsController)
router.get("/:project_id/engines", getProjectEnginesController)
router.put("/:project_id/engines", updateProjectEnginesController)

export default router
