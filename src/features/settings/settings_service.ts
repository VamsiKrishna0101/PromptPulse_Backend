import bcrypt from "bcryptjs"
import prisma from "../../lib/prisma"

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
