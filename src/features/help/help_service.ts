import prisma from '../../lib/prisma'
import type { HelpCenterInput } from './help_types'

export async function createHelpCenterTicket(
    input: HelpCenterInput,
    user_id: string
) {
    return prisma.helpCenter.create({
        data: {
            user_id,
            email: input.email,
            subject: input.subject,
            message: input.message,
        },
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

export async function getUserTickets(user_id: string) {
    return prisma.helpCenter.findMany({
        where: {
            user_id,
        },
        orderBy: {
            created_at: "desc",
        },
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
