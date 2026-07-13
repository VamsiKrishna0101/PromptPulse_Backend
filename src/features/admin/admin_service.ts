import { Plan, Prisma, SubscriptionStatus, UserRole } from "@prisma/client"
import prisma from "../../lib/prisma"
import type {
    AdminListProjectsInput,
    AdminListSubscriptionsInput,
    AdminListTicketsInput,
    AdminListUsersInput,
    AdminPage,
    AdminPaginationInput,
} from "./admin_types"

const ACCESS_STATUSES: SubscriptionStatus[] = [
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
    SubscriptionStatus.PAST_DUE,
]

function pagination(input: AdminPaginationInput = {}) {
    const page = Math.max(1, input.page ?? 1)
    const page_size = Math.min(Math.max(1, input.page_size ?? 20), 100)
    return {
        page,
        page_size,
        skip: (page - 1) * page_size,
        take: page_size,
    }
}

function pageResult<T>(data: T[], total: number, page: number, page_size: number): AdminPage<T> {
    return {
        data,
        page,
        page_size,
        total,
        total_pages: Math.max(1, Math.ceil(total / page_size)),
    }
}

function startOfDay(daysAgo: number) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - daysAgo)
    return date
}

function readPlan(value?: string): Plan | undefined {
    if (!value) return undefined
    if (value in Plan) return value as Plan
    return undefined
}

function readRole(value?: string): UserRole | undefined {
    if (!value) return undefined
    if (value in UserRole) return value as UserRole
    return undefined
}

function readSubscriptionStatus(value?: string): SubscriptionStatus | undefined {
    if (!value) return undefined
    if (value in SubscriptionStatus) return value as SubscriptionStatus
    return undefined
}

export const adminParsers = {
    readPlan,
    readRole,
    readSubscriptionStatus,
}

export async function getAdminOverview() {
    const sevenDaysAgo = startOfDay(7)
    const thirtyDaysAgo = startOfDay(30)

    const [
        totalUsers,
        newUsers7d,
        totalProjects,
        totalPrompts,
        totalChats,
        openTickets,
        activeSubscriptions,
        revenueRows,
        usersByPlan,
        subscriptionsByStatus,
        recentUsers,
        recentTickets,
    ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { created_at: { gte: sevenDaysAgo } } }),
        prisma.project.count(),
        prisma.prompt.count(),
        prisma.chat.count({ where: { created_at: { gte: thirtyDaysAgo } } }),
        prisma.helpCenter.count({ where: { is_resolved: false } }),
        prisma.subscription.count({ where: { status: { in: ACCESS_STATUSES } } }),
        prisma.subscription.groupBy({
            by: ["plan"],
            where: { status: { in: ACCESS_STATUSES } },
            _sum: { amount_cents: true },
            _count: { _all: true },
        }),
        prisma.user.groupBy({
            by: ["plan"],
            _count: { _all: true },
        }),
        prisma.subscription.groupBy({
            by: ["status"],
            _count: { _all: true },
        }),
        prisma.user.findMany({
            orderBy: { created_at: "desc" },
            take: 6,
            select: {
                id: true,
                email: true,
                role: true,
                plan: true,
                is_verified: true,
                created_at: true,
                _count: { select: { projects: true } },
            },
        }),
        prisma.helpCenter.findMany({
            orderBy: { created_at: "desc" },
            take: 6,
            select: {
                id: true,
                email: true,
                subject: true,
                is_resolved: true,
                created_at: true,
            },
        }),
    ])

    const estimatedMrrCents = revenueRows.reduce((sum, row) => sum + (row._sum.amount_cents ?? 0), 0)

    return {
        summary: {
            total_users: totalUsers,
            new_users_7d: newUsers7d,
            total_projects: totalProjects,
            total_prompts: totalPrompts,
            chats_30d: totalChats,
            open_tickets: openTickets,
            active_subscriptions: activeSubscriptions,
            estimated_mrr_cents: estimatedMrrCents,
        },
        users_by_plan: Object.values(Plan).map(plan => ({
            plan,
            count: usersByPlan.find(row => row.plan === plan)?._count._all ?? 0,
        })),
        subscriptions_by_status: Object.values(SubscriptionStatus).map(status => ({
            status,
            count: subscriptionsByStatus.find(row => row.status === status)?._count._all ?? 0,
        })),
        revenue_by_plan: Object.values(Plan).map(plan => {
            const row = revenueRows.find(item => item.plan === plan)
            return {
                plan,
                subscriptions: row?._count._all ?? 0,
                amount_cents: row?._sum.amount_cents ?? 0,
            }
        }),
        recent_users: recentUsers,
        recent_tickets: recentTickets,
    }
}

export async function listAdminUsers(input: AdminListUsersInput = {}) {
    const { page, page_size, skip, take } = pagination(input)
    const where: Prisma.UserWhereInput = {}
    const q = input.q?.trim()

    if (q) {
        where.OR = [
            { email: { contains: q, mode: "insensitive" } },
            { projects: { some: { brand_name: { contains: q, mode: "insensitive" } } } },
        ]
    }
    if (input.plan) where.plan = input.plan
    if (input.role) where.role = input.role

    const [total, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
            where,
            orderBy: { created_at: "desc" },
            skip,
            take,
            select: {
                id: true,
                email: true,
                role: true,
                plan: true,
                account_type: true,
                is_verified: true,
                created_at: true,
                updated_at: true,
                _count: {
                    select: {
                        projects: true,
                        subscriptions: true,
                        helpcenter: true,
                    },
                },
                subscriptions: {
                    orderBy: { created_at: "desc" },
                    take: 1,
                    select: {
                        id: true,
                        plan: true,
                        status: true,
                        amount_cents: true,
                        current_period_end: true,
                        cancel_at_period_end: true,
                    },
                },
            },
        }),
    ])

    return pageResult(
        users.map(({ subscriptions, ...user }) => ({
            ...user,
            latest_subscription: subscriptions[0] ?? null,
        })),
        total,
        page,
        page_size,
    )
}

export async function getAdminUser(user_id: string) {
    const user = await prisma.user.findUnique({
        where: { id: user_id },
        select: {
            id: true,
            email: true,
            role: true,
            plan: true,
            account_type: true,
            is_verified: true,
            created_at: true,
            updated_at: true,
            projects: {
                orderBy: { created_at: "desc" },
                select: {
                    id: true,
                    brand_name: true,
                    brand_url: true,
                    brand_location: true,
                    created_at: true,
                    _count: {
                        select: {
                            prompts: true,
                            competitors: true,
                            runs: true,
                            sara_conversations: true,
                        },
                    },
                },
            },
            subscriptions: {
                orderBy: { created_at: "desc" },
                select: {
                    id: true,
                    plan: true,
                    status: true,
                    amount_cents: true,
                    currency: true,
                    current_period_start: true,
                    current_period_end: true,
                    cancel_at_period_end: true,
                    trial_starts_at: true,
                    trial_ends_at: true,
                    stripe_customer_id: true,
                    stripe_subscription_id: true,
                    created_at: true,
                },
            },
            plan_usages: {
                orderBy: { period_start: "desc" },
                take: 6,
            },
            helpcenter: {
                orderBy: { created_at: "desc" },
                take: 10,
                select: {
                    id: true,
                    subject: true,
                    message: true,
                    is_resolved: true,
                    created_at: true,
                    updated_at: true,
                },
            },
            _count: {
                select: {
                    projects: true,
                    sara_conversations: true,
                    helpcenter: true,
                },
            },
        },
    })

    if (!user) throw new Error("USER_NOT_FOUND")
    return user
}

export async function listAdminProjects(input: AdminListProjectsInput = {}) {
    const { page, page_size, skip, take } = pagination(input)
    const q = input.q?.trim()
    const where: Prisma.ProjectWhereInput = q ? {
        OR: [
            { brand_name: { contains: q, mode: "insensitive" } },
            { brand_url: { contains: q, mode: "insensitive" } },
            { brand_location: { contains: q, mode: "insensitive" } },
            { user: { email: { contains: q, mode: "insensitive" } } },
        ],
    } : {}

    const [total, projects] = await Promise.all([
        prisma.project.count({ where }),
        prisma.project.findMany({
            where,
            orderBy: { created_at: "desc" },
            skip,
            take,
            select: {
                id: true,
                brand_name: true,
                brand_url: true,
                brand_location: true,
                created_at: true,
                updated_at: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        plan: true,
                    },
                },
                _count: {
                    select: {
                        prompts: true,
                        competitors: true,
                        runs: true,
                        scrape_jobs: true,
                        sara_conversations: true,
                        topics: true,
                    },
                },
            },
        }),
    ])

    return pageResult(projects, total, page, page_size)
}

export async function listAdminSubscriptions(input: AdminListSubscriptionsInput = {}) {
    const { page, page_size, skip, take } = pagination(input)
    const where: Prisma.SubscriptionWhereInput = {}
    const q = input.q?.trim()

    if (input.plan) where.plan = input.plan
    if (input.status) where.status = input.status
    if (q) {
        where.OR = [
            { stripe_customer_id: { contains: q, mode: "insensitive" } },
            { stripe_subscription_id: { contains: q, mode: "insensitive" } },
            { user: { email: { contains: q, mode: "insensitive" } } },
        ]
    }

    const [total, subscriptions] = await Promise.all([
        prisma.subscription.count({ where }),
        prisma.subscription.findMany({
            where,
            orderBy: { created_at: "desc" },
            skip,
            take,
            select: {
                id: true,
                plan: true,
                status: true,
                amount_cents: true,
                currency: true,
                current_period_start: true,
                current_period_end: true,
                cancel_at_period_end: true,
                trial_starts_at: true,
                trial_ends_at: true,
                stripe_customer_id: true,
                stripe_subscription_id: true,
                created_at: true,
                updated_at: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        plan: true,
                    },
                },
            },
        }),
    ])

    return pageResult(subscriptions, total, page, page_size)
}

export async function listAdminTickets(input: AdminListTicketsInput = {}) {
    const { page, page_size, skip, take } = pagination(input)
    const where: Prisma.HelpCenterWhereInput = {}
    const q = input.q?.trim()

    if (input.status === "open") where.is_resolved = false
    if (input.status === "resolved") where.is_resolved = true
    if (q) {
        where.OR = [
            { email: { contains: q, mode: "insensitive" } },
            { subject: { contains: q, mode: "insensitive" } },
            { message: { contains: q, mode: "insensitive" } },
            { user: { email: { contains: q, mode: "insensitive" } } },
        ]
    }

    const [total, tickets] = await Promise.all([
        prisma.helpCenter.count({ where }),
        prisma.helpCenter.findMany({
            where,
            orderBy: { created_at: "desc" },
            skip,
            take,
            select: {
                id: true,
                email: true,
                subject: true,
                message: true,
                is_resolved: true,
                created_at: true,
                updated_at: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        plan: true,
                    },
                },
            },
        }),
    ])

    return pageResult(tickets, total, page, page_size)
}

export async function setAdminTicketResolved(ticket_id: string, is_resolved: boolean) {
    const ticket = await prisma.helpCenter.findUnique({
        where: { id: ticket_id },
        select: { id: true },
    })

    if (!ticket) throw new Error("TICKET_NOT_FOUND")

    return prisma.helpCenter.update({
        where: { id: ticket_id },
        data: { is_resolved },
        select: {
            id: true,
            email: true,
            subject: true,
            message: true,
            is_resolved: true,
            created_at: true,
            updated_at: true,
        },
    })
}
