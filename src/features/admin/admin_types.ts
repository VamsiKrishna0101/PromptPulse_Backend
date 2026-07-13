import type { Plan, SubscriptionStatus, UserRole } from "@prisma/client"

export type AdminPaginationInput = {
    page?: number
    page_size?: number
}

export type AdminListUsersInput = AdminPaginationInput & {
    q?: string
    plan?: Plan
    role?: UserRole
}

export type AdminListProjectsInput = AdminPaginationInput & {
    q?: string
}

export type AdminListSubscriptionsInput = AdminPaginationInput & {
    q?: string
    plan?: Plan
    status?: SubscriptionStatus
}

export type AdminListTicketsInput = AdminPaginationInput & {
    q?: string
    status?: "open" | "resolved" | "all"
}

export type AdminPage<T> = {
    data: T[]
    page: number
    page_size: number
    total: number
    total_pages: number
}
