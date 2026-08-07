import type { Prisma } from "@prisma/client"
import prisma from "../../../lib/prisma"

function jsonPayload(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export const seoSnapshotRepository = {
    findLatest(input: {
        projectId: string
        feature: string
        scopeKey: string
    }) {
        return prisma.seoProviderSnapshot.findFirst({
            where: {
                project_id: input.projectId,
                feature: input.feature,
                scope_key: input.scopeKey,
            },
            orderBy: { fetched_at: "desc" },
        })
    },

    findRecentByFeature(input: {
        projectId: string
        feature: string
        limit: number
    }) {
        return prisma.seoProviderSnapshot.findMany({
            where: {
                project_id: input.projectId,
                feature: input.feature,
            },
            orderBy: { fetched_at: "desc" },
            take: input.limit,
        })
    },

    create(input: {
        projectId: string
        userId: string
        feature: string
        scopeKey: string
        payload: unknown
        providerEnvironment: "sandbox" | "production"
        providerCostUsd: number
        providerTaskIds: string[]
        expiresAt: Date
    }) {
        return prisma.seoProviderSnapshot.create({
            data: {
                project_id: input.projectId,
                requested_by_user_id: input.userId,
                feature: input.feature,
                scope_key: input.scopeKey,
                payload: jsonPayload(input.payload),
                provider_environment: input.providerEnvironment,
                provider_cost_usd: input.providerCostUsd,
                provider_task_ids: input.providerTaskIds,
                expires_at: input.expiresAt,
            },
        })
    },
}
