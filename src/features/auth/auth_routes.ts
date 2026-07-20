import { Router } from 'express'
import { refresh, register, verifyOtp, login } from './auth_controller'

const router = Router()

router.post('/register', register)
router.post('/verify', verifyOtp)
router.post('/login', login)
router.post('/refresh', refresh)

export default router
