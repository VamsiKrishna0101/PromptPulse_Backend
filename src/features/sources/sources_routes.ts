import { Router } from 'express'
import {
    getDomainReportController,
    getSourceGapsController,
    getSourceTrendController,
    getTopSourcesController,
    getUrlContentController,
    getUrlReportController
} from './sources_controller'

const router = Router()

router.get('/:project_id/top', getTopSourcesController)
router.get('/:project_id/domains', getDomainReportController)
router.get('/:project_id/urls', getUrlReportController)
router.get('/:project_id/url-content', getUrlContentController)
router.get('/:project_id/gaps', getSourceGapsController)
router.get('/:project_id/trend', getSourceTrendController)

export default router
