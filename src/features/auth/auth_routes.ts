import { Router } from 'express'
import { forgotPasswordReset, forgotPasswordSendOtp, refresh, register, verifyOtp, login } from './auth_controller'

const router = Router()

router.post('/register', register)
router.post('/verify', verifyOtp)
router.post('/login', login)
router.post('/forgot-password/send-otp', forgotPasswordSendOtp)
router.post('/forgot-password/reset', forgotPasswordReset)
router.post('/refresh', refresh)

export default router
