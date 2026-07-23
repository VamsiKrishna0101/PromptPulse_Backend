import prisma from "../../../lib/prisma"
import { getCreditBalance } from "../../credits/credits_service"
import { formatDate, type SaraContextSection } from "./context_format"
import { Plan } from "@prisma/client"

export type SaraPlanContext = {
    plan: Plan
    sara_level: "basic" | "full" | "advanced"
    guidance: string
    section: SaraContextSection
}

// PAYG: Sara always operates at the highest capability level
const PAYG_GUIDANCE = "Full strategist assistant: connect dashboard metrics, sources, prompts, competitors, and action queue into prioritized, actionable recommendations. All features are unlocked — the user is on a Pay-As-You-Go plan with no tier restrictions."

export async function buildSaraPlanContext(user_id: string): Promise<SaraPlanContext> {
    const [creditBalance, usage] = await Promise.all([
        getCreditBalance(user_id),
        prisma.planUsage.findFirst({
            where: { user_id },
            orderBy: { period_start: "desc" },
        }),
    ])

    return {
        plan: Plan.FREE, // kept for type compat — not meaningful in PAYG
        sara_level: "advanced", // PAYG: always full access
        guidance: PAYG_GUIDANCE,
        section: {
            title: "Billing and Sara Access",
            lines: [
                "Billing model: Pay-As-You-Go (no plan tiers)",
                "Sara mode: Advanced (full access — all features unlocked)",
                `Sara behavior: ${PAYG_GUIDANCE}`,
                `Credit balance: ${creditBalance.remaining} credits remaining`,
                `Usage: ${usage?.project_count ?? 0} project(s), ${usage?.prompt_count ?? 0} prompt(s), ${usage?.competitor_count ?? 0} competitor(s)`,
            ],
        },
    }
}
