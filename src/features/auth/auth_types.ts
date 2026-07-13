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
    }
    accessToken: string
    refreshToken: string
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
        is_verified: boolean

    },
    access_token: string,
    refresh_token: string
}
