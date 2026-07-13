import { Router } from "express"
import { downloadCsvExportController, exportGeoArticlePdfController } from "./export_controller"

const router = Router()

router.get("/:project_id/:resource", downloadCsvExportController)
router.post("/:project_id/geoarticle-pdf", exportGeoArticlePdfController)

export default router
