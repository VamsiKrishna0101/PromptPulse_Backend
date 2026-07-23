export type RegisterInput = {
    email: string
    password: string
    account_type: 'SINGLE' | 'AGENCY'
}

export type RegisterResponse = {
    message: string
    user: {
        id: string
        email: string
        account_type: string
        role: string
        plan: string
        effective_plan?: string
        is_verified: boolean
        credits_balance?: number
    }
    accessToken?: string
    refreshToken?: string
    access_token?: string
    refresh_token?: string
}

export type LoginInput = {
    email: string,
    password: string
}

export type LoginResponse = {
    message: string,
    user: {
        id: string,
        email: string,
        account_type: string,
        role: string,
        plan: string,
        effective_plan?: string,
        is_verified: boolean
        credits_balance?: number

    },
    access_token: string,
    refresh_token: string
}

export type ForgotPasswordOtpInput = {
    email: string
}

export type ResetPasswordInput = {
    email: string
    otp: string
    password: string
}
