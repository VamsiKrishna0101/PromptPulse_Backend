import { Router } from 'express'
import {
    runPromptController,
    getDashboardDataController,
    getVisibilityTimeSeriesController,
    getRecentChatsController,
    getChatsPageController,
    getFilterOptionsController
} from './dashboard_controller'

const router = Router()

router.post('/run', runPromptController)
router.get('/:project_id/filters', getFilterOptionsController)
router.get('/:project_id/timeseries', getVisibilityTimeSeriesController)
router.get('/:project_id/recent-chats', getRecentChatsController)
router.get('/:project_id/chats', getChatsPageController)
router.get('/:project_id', getDashboardDataController)

export default router
