import { Router } from "express"
import { enqueueProjectRunController, getScrapeRunController } from "./scraping_controller"

const router = Router()

router.post("/runs", enqueueProjectRunController)
router.get("/runs/:run_id", getScrapeRunController)

export default router
