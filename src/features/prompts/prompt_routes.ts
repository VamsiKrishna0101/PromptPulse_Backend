import { Router } from 'express'
import {
    getPromptsController,
    getPromptStatsController,
    activatePromptController,
    deactivatePromptController,
    getPromptTopicsController,
    createTopicController,
    createPromptController,
    listGeoCountriesController,
    listGeoVariantsController,
    addGeoVariantController,
    deleteGeoVariantController,
    toggleGeoVariantController,
    getGeoStatsController,
    discoverPromptsController
} from './prompt_controller'

const router = Router()

router.post('/:prompt_id/activate', activatePromptController)
router.post('/:prompt_id/deactivate', deactivatePromptController)

// Geo endpoints
router.get('/geo/countries', listGeoCountriesController)
router.get('/:prompt_id/geo', listGeoVariantsController)
router.post('/:prompt_id/geo', addGeoVariantController)
router.delete('/geo/variants/:variant_id', deleteGeoVariantController)
router.patch('/geo/variants/:variant_id/toggle', toggleGeoVariantController)
router.get('/:project_id/geo-stats', getGeoStatsController)

router.post('/:project_id/discovery/run', discoverPromptsController)
router.get('/:project_id/stats', getPromptStatsController)
router.get('/:project_id/topics', getPromptTopicsController)
router.post('/:project_id/topics', createTopicController)
router.post('/:project_id', createPromptController)
router.get('/:project_id', getPromptsController)

export default router
