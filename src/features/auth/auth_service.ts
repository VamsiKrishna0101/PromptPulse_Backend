import { Resend } from 'resend'
import bcrypt from 'bcryptjs'
import prisma from '../../lib/prisma'
import { isWorkEmail, generateOtp } from '../../utils/email'
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt'
import type { RegisterInput, RegisterResponse, LoginInput, LoginResponse } from './auth_types'


export async function verifyUserOtp(email: string, otp: string) {
    const user = await prisma.user.findUnique({ where: { email } })

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

    return {
        message: 'Email verified successfully',
        user: updatedUser,
    }
}


export async function registerUser(input: RegisterInput): Promise<RegisterResponse> {
    const { email, password, account_type } = input

    // 1. Work email check
    if (!isWorkEmail(email)) {
        throw new Error('Only work/business email addresses are allowed.')
    }

    // 2. Duplicate check
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
        throw new Error('An account with this email already exists.')
    }

    // 3. Hash password
    const salt = await bcrypt.genSalt(10)
    const hashedPassword = await bcrypt.hash(password, salt)

    // 5. Create user
    const user = await prisma.user.create({
        data: {
            email,
            password: hashedPassword,
            account_type,
            is_verified: true, // Set to true by default as requested
        },
        select: {
            id: true,
            email: true,
            account_type: true,
            role: true,
            plan: true,
        },
    })

    // 7. Issue tokens
    const accessToken = generateAccessToken(user.id)
    const refreshToken = generateRefreshToken(user.id)

    return {
        message: 'Registration successful.',
        user,
        accessToken,
        refreshToken,
    }
}

export async function login(input: LoginInput): Promise<LoginResponse> {
    const { email, password } = input

    const user = await prisma.user.findUnique({
        where: { email },
        select: {
            id: true,
            email: true,
            password: true,
            account_type: true,
            role: true,
            plan: true,
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
    return {
        message: "welcome back",
        user: {
            id: user.id,
            email: user.email,
            account_type: user.account_type,
            role: user.role,
            plan: user.plan,
            is_verified: user.is_verified
        },
        access_token: accessToken,
        refresh_token: refreshToken
    }
}
