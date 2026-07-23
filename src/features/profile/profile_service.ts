import prisma from "../../lib/prisma"
import { getCreditBalance } from "../credits/credits_service"

export async function getProfileData(userId: string) {
    const [user, projects, wallet, planUsage] = await Promise.all([
        prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                is_verified: true,
                account_type: true,
                role: true,
                plan: true,
                created_at: true,
            },
        }),
        prisma.project.findMany({
            where: { user_id: userId },
            orderBy: { created_at: "desc" },
            select: {
                id: true,
                brand_name: true,
                brand_url: true,
                brand_location: true,
                created_at: true,
                updated_at: true,
            },
        }),
        getCreditBalance(userId),
        prisma.planUsage.findFirst({
            where: { user_id: userId },
            orderBy: { period_start: "desc" },
            select: {
                prompt_count: true,
                project_count: true,
                competitor_count: true,
                monthly_runs_used: true,
                period_start: true,
                period_end: true,
            },
        }),
    ])

    if (!user) {
        throw new Error("User not found")
    }

    return {
        user: {
            ...user,
            plan: "PAYG",
            effective_plan: "PAYG",
        },
        projects,
        wallet: {
            balance: wallet.remaining,
            used: wallet.used,
        },
        usage: planUsage ?? {
            prompt_count: 0,
            project_count: 0,
            competitor_count: 0,
            monthly_runs_used: 0,
            period_start: null,
            period_end: null,
        },
    }
}
