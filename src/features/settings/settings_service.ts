import bcrypt from "bcryptjs"
import prisma from "../../lib/prisma"
import { AccountType } from "@prisma/client"

export async function getSettings(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            is_verified: true,
            account_type: true,
            role: true,
            plan: true,
            created_at: true,
            updated_at: true,
        },
    })

    if (!user) {
        throw new Error("User not found")
    }

    return {
        account: user,
        security: {
            password_enabled: true,
            email_verified: user.is_verified,
        },
        product: {
            weekly_email_reports: true,
            sara_recommendations: true,
            export_notifications: true,
        },
    }
}

export async function updatePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            password: true,
        },
    })

    if (!user) {
        throw new Error("User not found")
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password)
    if (!validPassword) {
        throw new Error("Current password is incorrect")
    }

    const reusedPassword = await bcrypt.compare(newPassword, user.password)
    if (reusedPassword) {
        throw new Error("New password must be different from current password")
    }

    const salt = await bcrypt.genSalt(10)
    const password = await bcrypt.hash(newPassword, salt)

    await prisma.user.update({
        where: { id: userId },
        data: { password },
    })

    return { message: "Password updated successfully" }
}

export async function updateAccountType(userId: string, accountType: AccountType) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { account_type: true } })
    if (!user) throw new Error("User not found")
    if (user.account_type === accountType) return { account_type: accountType }
    if (user.account_type === AccountType.AGENCY) {
        throw new Error("Agency accounts cannot be converted to individual accounts while shared workspace data exists")
    }
    const paidSubscription = await prisma.subscription.findFirst({
        where: { user_id: userId, plan: { not: "FREE" }, status: { in: ["ACTIVE", "PAST_DUE", "INCOMPLETE"] } },
        select: { id: true },
    })
    if (paidSubscription) throw new Error("Cancel the active individual subscription before converting to an agency account")
    await prisma.user.update({ where: { id: userId }, data: { account_type: AccountType.AGENCY } })
    return { account_type: AccountType.AGENCY }
}
