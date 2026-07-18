import { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma"
import { assertProjectAccess } from "../projects/project_access"
import type { BrandPreferencePayload } from "./brand_preferences_types"

export async function getBrandPreference(projectId: string, userId: string) {
    await assertProjectAccess(projectId, userId)
    return prisma.brandPreference.findFirst({
        where: {
            project_id: projectId,
            user_id: userId,
        },
    })
}

export async function upsertBrandPreference(projectId: string, userId: string, payload: BrandPreferencePayload) {
    await assertProjectAccess(projectId, userId)

    return prisma.brandPreference.upsert({
        where: { project_id: projectId },
        create: {
            project_id: projectId,
            user_id: userId,
            industry_category: payload.industry_category,
            buyer_persona: payload.buyer_persona ?? null,
            keywords: payload.keywords as Prisma.InputJsonValue,
            avoid_keywords: payload.avoid_keywords as Prisma.InputJsonValue,
            competitor_context: payload.competitor_context ?? null,
            reddit_focus: payload.reddit_focus as Prisma.InputJsonValue,
        },
        update: {
            industry_category: payload.industry_category,
            buyer_persona: payload.buyer_persona ?? null,
            keywords: payload.keywords as Prisma.InputJsonValue,
            avoid_keywords: payload.avoid_keywords as Prisma.InputJsonValue,
            competitor_context: payload.competitor_context ?? null,
            reddit_focus: payload.reddit_focus as Prisma.InputJsonValue,
        },
    })
}

export async function hasRunnableBrandPreference(projectId: string, userId: string) {
    const preference = await getBrandPreference(projectId, userId)
    const keywords = Array.isArray(preference?.keywords) ? preference.keywords : []
    return Boolean(preference?.industry_category?.trim() && keywords.length > 0)
}
