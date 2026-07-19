import { Router } from "express"
import { enqueueProjectRunController, getScrapeRunController } from "./scraping_controller"
import { retryFailedJobsController } from "./scrape_retry_controller"

const router = Router()

router.post("/runs", enqueueProjectRunController)
router.get("/runs/:run_id", getScrapeRunController)
router.post("/runs/:run_id/retry-failed", retryFailedJobsController)

export default router
