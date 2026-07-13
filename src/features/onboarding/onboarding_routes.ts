import { Router } from 'express'
import { researchBrandController, generatePromptsController, createProjectController } from './onboarding_controller'

const router = Router()

router.post('/research', researchBrandController)
router.post('/prompts', generatePromptsController)
router.post('/project', createProjectController)

export default router
