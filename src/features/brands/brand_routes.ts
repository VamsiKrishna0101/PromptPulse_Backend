import { Router } from 'express'
import {
    getDiscoveredBrandsController,
    addCompetitorController,
    getTrackedCompetitorsController,
    removeCompetitorController
} from './brand_controller'

const router = Router()

router.get('/:project_id/discovered', getDiscoveredBrandsController)
router.get('/:project_id/tracked', getTrackedCompetitorsController)
router.post('/:project_id/competitors', addCompetitorController)
router.delete('/competitors/:competitor_id', removeCompetitorController)

export default router
