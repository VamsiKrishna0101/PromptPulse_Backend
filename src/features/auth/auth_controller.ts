import { Request, Response } from 'express'
import { z } from 'zod'
import { refreshAccessToken, registerUser, resetPasswordWithOtp, sendForgotPasswordOtp, verifyUserOtp, login as loginService } from './auth_service'

const registerSchema = z.object({
    email: z.string().email('Invalid email format'),
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
    account_type: z.enum(['SINGLE', 'AGENCY'], {
        error: 'account_type must be SINGLE or AGENCY',
    }),
})

export async function register(req: Request, res: Response): Promise<void> {
    const parsed = registerSchema.safeParse(req.body)

    if (!parsed.success) {
        res.status(400).json({
            success: false,
            errors: parsed.error.flatten().fieldErrors,
        })
        return
    }

    try {
        const result = await registerUser(parsed.data)
        res.status(201).json({ success: true, ...result })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Registration failed'
        const isEmailDeliveryError = message.includes('Brevo email send failed')
        const status =
            message.includes('already exists') ? 409
                : message.includes('work/business') ? 422
                    : isEmailDeliveryError ? 502
                    : 500
        res.status(status).json({
            success: false,
            message: isEmailDeliveryError
                ? "We could not send your verification code right now. Please try again in a moment."
                : message,
        })
    }
}

const verifyOtpSchema = z.object({
    email: z.string().email('Invalid email format'),
    otp: z.string().length(6, 'OTP must be exactly 6 digits'),
})

export async function verifyOtp(req: Request, res: Response): Promise<void> {
    const parsed = verifyOtpSchema.safeParse(req.body)

    if (!parsed.success) {
        res.status(400).json({
            success: false,
            errors: parsed.error.flatten().fieldErrors,
        })
        return
    }

    try {
        const result = await verifyUserOtp(parsed.data.email, parsed.data.otp)
        res.status(200).json({ success: true, ...result })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Verification failed'
        res.status(400).json({ success: false, message })
    }
}

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string()
})

const forgotPasswordOtpSchema = z.object({
    email: z.string().email('Invalid email format'),
})

const resetPasswordSchema = z.object({
    email: z.string().email('Invalid email format'),
    otp: z.string().length(6, 'OTP must be exactly 6 digits'),
    password: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
})

export async function login(req: Request, res: Response): Promise<void> {
    const parsed = loginSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            errors: parsed.error.flatten().fieldErrors
        })
        return
    }
    try {
        const result = await loginService(parsed.data)
        res.status(200).json({ success: true, ...result })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Login failed'
        res.status(401).json({ success: false, message })
    }
}

export async function forgotPasswordSendOtp(req: Request, res: Response): Promise<void> {
    const parsed = forgotPasswordOtpSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            errors: parsed.error.flatten().fieldErrors,
        })
        return
    }

    try {
        const result = await sendForgotPasswordOtp(parsed.data.email)
        res.status(200).json({ success: true, ...result })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to send password reset OTP'
        const isEmailDeliveryError = message.includes('Brevo email send failed')
        res.status(isEmailDeliveryError ? 502 : 500).json({
            success: false,
            message: isEmailDeliveryError
                ? "We could not send your password reset code right now. Please try again in a moment."
                : message,
        })
    }
}

export async function forgotPasswordReset(req: Request, res: Response): Promise<void> {
    const parsed = resetPasswordSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({
            success: false,
            errors: parsed.error.flatten().fieldErrors,
        })
        return
    }

    try {
        const result = await resetPasswordWithOtp(parsed.data.email, parsed.data.otp, parsed.data.password)
        res.status(200).json({ success: true, ...result })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to reset password'
        res.status(400).json({ success: false, message })
    }
}

const refreshSchema = z.object({
    refresh_token: z.string().min(1),
})

export async function refresh(req: Request, res: Response): Promise<void> {
    const parsed = refreshSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(401).json({ success: false, message: 'Refresh token is required' })
        return
    }

    try {
        res.status(200).json({ success: true, ...await refreshAccessToken(parsed.data.refresh_token) })
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Session expired'
        res.status(401).json({ success: false, message })
    }
}
