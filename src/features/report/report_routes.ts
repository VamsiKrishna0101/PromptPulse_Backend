import { Router } from "express"
import {
    generateReportController,
    getReportController,
    listReportsController,
} from "./report_controller"

const router = Router()

router.get("/", listReportsController)
router.get("/:report_id", getReportController)
router.post("/generate", generateReportController)

export default router
