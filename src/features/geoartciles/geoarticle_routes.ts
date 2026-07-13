import { Router } from "express"
import {
    deleteSavedGeoArticleController,
    getGeoArticleController,
    getSavedGeoArticleController,
    listSavedGeoArticlesController,
} from "./geoarticle_controller"

const router = Router()

router.get("/:project_id/saved", listSavedGeoArticlesController)
router.get("/:project_id/saved/:content_brief_id", getSavedGeoArticleController)
router.delete("/:project_id/saved/:content_brief_id", deleteSavedGeoArticleController)
router.get("/:project_id", getGeoArticleController)

export default router
