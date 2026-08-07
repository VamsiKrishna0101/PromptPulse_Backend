import bcrypt from 'bcryptjs'
import prisma from '../../lib/prisma'
import { isWorkEmail, generateOtp } from '../../utils/email'
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt'
import type { RegisterInput, RegisterResponse, LoginInput, LoginResponse } from './auth_types'
import { sendVerificationOtpEmail } from '../email/email_service'
import { ensureFreeTrialSubscription, getEffectivePlanAccess } from '../subscription/entitlements'
import { awardCredits } from '../payments/credits_service'
import { signupBonusFor } from '../payments/credits_config'
import jwt from 'jsonwebtoken'


export async function verifyUserOtp(email: string, otp: string) {
    const normalizedEmail = email.trim().toLowerCase()
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

    if (!user) {
        throw new Error('User not found')
    }

    if (user.is_verified) {
        throw new Error('User is already verified')
    }

    if (user.otp !== otp) {
        throw new Error('Invalid OTP')
    }

    if (!user.otp_expires_at || user.otp_expires_at < new Date()) {
        throw new Error('OTP has expired')
    }

    const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
            is_verified: true,
            otp: null,
            otp_expires_at: null,
        },
        select: {
            id: true,
            email: true,
            account_type: true,
            role: true,
            plan: true,
            is_verified: true,
        },
    })

    await ensureFreeTrialSubscription(updatedUser.id)

    // Award signup bonus credits — only if this is a fresh verification (balance is 0)
    const currentUser = await prisma.user.findUnique({ where: { id: updatedUser.id }, select: { credits_balance: true } })
    const signupBonus = signupBonusFor(updatedUser.account_type)
    if ((currentUser?.credits_balance ?? 0) === 0) {
        await awardCredits(updatedUser.id, signupBonus, 'SIGNUP_BONUS', `${signupBonus} free trial credits on account verification`)
    }

    const access = await getEffectivePlanAccess(updatedUser.id)
    const finalUser = await prisma.user.findUnique({ where: { id: updatedUser.id }, select: { credits_balance: true } })

    const accessToken = generateAccessToken(updatedUser.id)
    const refreshToken = generateRefreshToken(updatedUser.id)

    return {
        message: 'Email verified successfully',
        user: { ...updatedUser, effective_plan: access.effective_plan, credits_balance: finalUser?.credits_balance ?? signupBonus },
        access_token: accessToken,
        refresh_token: refreshToken,
        accessToken,
        refreshToken,
    }
}


export async function registerUser(input: RegisterInput): Promise<RegisterResponse> {
    const email = input.email.trim().toLowerCase()
    const { password, account_type } = input

    // 1. Work email check
    if (!isWorkEmail(email)) {
        throw new Error('Only work/business email addresses are allowed.')
    }

    // 2. Duplicate check
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing?.is_verified) {
        throw new Error('An account with this email already exists.')
    }

    // 3. Hash password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    const otp = generateOtp()
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000)

    // 5. Create or refresh an unverified user, then send OTP.
    const user = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: {
                password: hashedPassword,
                account_type,
                is_verified: false,
                otp,
                otp_expires_at: otpExpiresAt,
            },
            select: {
                id: true,
                email: true,
                account_type: true,
                role: true,
                plan: true,
                is_verified: true,
            },
        })
        : await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                account_type,
                is_verified: false,
                otp,
                otp_expires_at: otpExpiresAt,
            },
            select: {
                id: true,
                email: true,
                account_type: true,
                role: true,
                plan: true,
                is_verified: true,
            },
        })

    try {
        await sendVerificationOtpEmail(email, otp)
    } catch (error) {
        const allowDevOtpFallback = process.env.NODE_ENV !== "production" && process.env.EMAIL_DEV_OTP_FALLBACK !== "false"
        if (!allowDevOtpFallback) throw error

        console.warn(`[DEV OTP FALLBACK] Could not send verification email to ${email}. Use OTP: ${otp}`)
    }

    return {
        message: 'Verification code sent.',
        user,
    }
}

export async function login(input: LoginInput): Promise<LoginResponse> {
    const email = input.email.trim().toLowerCase()
    const { password } = input

    const user = await prisma.user.findUnique({
        where: { email },
        select: {
            id: true,
            email: true,
            password: true,
            account_type: true,
            role: true,
            plan: true,
            credits_balance: true,
            is_verified: true,
        }
    })
    if (!user) {
        throw new Error("user not found")
    }
    const isPasswordValid = await bcrypt.compare(password, user.password)
    if (!isPasswordValid) {
        throw new Error("email or password is incorrect")
    }
    const accessToken = generateAccessToken(user.id)
    const refreshToken = generateRefreshToken(user.id)
    if (!user.is_verified) {
        throw new Error("please verify your email")
    }
    await ensureFreeTrialSubscription(user.id)
    const access = await getEffectivePlanAccess(user.id)
    return {
        message: "welcome back",
        user: {
            id: user.id,
            email: user.email,
            account_type: user.account_type,
            role: user.role,
            plan: user.plan,
            effective_plan: access.effective_plan,
            is_verified: user.is_verified,
            credits_balance: user.credits_balance,
        },
        access_token: accessToken,
        refresh_token: refreshToken
    }
}

export async function sendForgotPasswordOtp(email: string) {
    const normalizedEmail = email.trim().toLowerCase()
    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, is_verified: true },
    })

    if (!user?.is_verified) {
        return { message: "If this account exists, an OTP has been sent." }
    }

    const otp = generateOtp()
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000)

    await prisma.user.update({
        where: { id: user.id },
        data: {
            otp,
            otp_expires_at: otpExpiresAt,
        },
    })

    try {
        await sendVerificationOtpEmail(normalizedEmail, otp)
    } catch (error) {
        const allowDevOtpFallback = process.env.NODE_ENV !== "production" && process.env.EMAIL_DEV_OTP_FALLBACK !== "false"
        if (!allowDevOtpFallback) throw error

        console.warn(`[DEV OTP FALLBACK] Could not send password reset OTP to ${normalizedEmail}. Use OTP: ${otp}`)
    }

    return { message: "If this account exists, an OTP has been sent." }
}

export async function resetPasswordWithOtp(email: string, otp: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase()
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })

    if (!user || !user.is_verified) {
        throw new Error("Invalid or expired OTP")
    }

    if (user.otp !== otp) {
        throw new Error("Invalid or expired OTP")
    }

    if (!user.otp_expires_at || user.otp_expires_at < new Date()) {
        throw new Error("Invalid or expired OTP")
    }

    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    await prisma.user.update({
        where: { id: user.id },
        data: {
            password: hashedPassword,
            otp: null,
            otp_expires_at: null,
        },
    })

    return { message: "Password updated successfully" }
}

export async function refreshAccessToken(refreshToken: string) {
    let payload: { sub?: string }
    try {
        payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { sub?: string }
    } catch {
        throw new Error('Invalid or expired refresh token')
    }

    if (!payload.sub) throw new Error('Invalid refresh token')

    const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, is_verified: true }
    })

    if (!user || !user.is_verified) throw new Error('Invalid refresh user')

    return {
        access_token: generateAccessToken(user.id),
        refresh_token: generateRefreshToken(user.id),
    }
}
