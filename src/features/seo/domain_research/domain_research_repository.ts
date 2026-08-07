import prisma from "../../../lib/prisma"
import type { Prisma } from "@prisma/client"
import type { DomainResearchScope } from "./domain_research_types"

type SnapshotCreateInput = {
    scope: DomainResearchScope
    payload: unknown
    providerEnvironment: "sandbox" | "production"
    providerCostUsd: number
    providerTaskIds: string[]
    expiresAt: Date
}

function snapshotWhere(scope: DomainResearchScope) {
    return {
        project_id: scope.projectId,
        target_domain: scope.domain,
        location_code: scope.market.locationCode,
        language_code: scope.market.languageCode,
    }
}

function jsonPayload(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export const domainResearchRepository = {
    findOverview(scope: DomainResearchScope, historyMonths: number) {
        return prisma.seoDomainResearchOverviewSnapshot.findFirst({
            where: {
                ...snapshotWhere(scope),
                history_months: historyMonths,
            },
            orderBy: { fetched_at: "desc" },
        })
    },

    createOverview(input: SnapshotCreateInput & { historyMonths: number }) {
        return prisma.seoDomainResearchOverviewSnapshot.create({
            data: {
                project_id: input.scope.projectId,
                requested_by_user_id: input.scope.userId,
                target_domain: input.scope.domain,
                location_code: input.scope.market.locationCode,
                country_iso_code: input.scope.market.countryIsoCode,
                language_code: input.scope.market.languageCode,
                history_months: input.historyMonths,
                payload: jsonPayload(input.payload),
                provider_environment: input.providerEnvironment,
                provider_cost_usd: input.providerCostUsd,
                provider_task_ids: input.providerTaskIds,
                expires_at: input.expiresAt,
            },
        })
    },

    findOrganicKeywords(scope: DomainResearchScope) {
        return prisma.seoDomainResearchKeywordSnapshot.findFirst({
            where: snapshotWhere(scope),
            orderBy: { fetched_at: "desc" },
        })
    },

    createOrganicKeywords(input: SnapshotCreateInput & {
        itemLimit: number
        totalCount: number
    }) {
        return prisma.seoDomainResearchKeywordSnapshot.create({
            data: {
                project_id: input.scope.projectId,
                requested_by_user_id: input.scope.userId,
                target_domain: input.scope.domain,
                location_code: input.scope.market.locationCode,
                country_iso_code: input.scope.market.countryIsoCode,
                language_code: input.scope.market.languageCode,
                item_limit: input.itemLimit,
                total_count: input.totalCount,
                payload: jsonPayload(input.payload),
                provider_environment: input.providerEnvironment,
                provider_cost_usd: input.providerCostUsd,
                provider_task_ids: input.providerTaskIds,
                expires_at: input.expiresAt,
            },
        })
    },

    findTopPages(scope: DomainResearchScope) {
        return prisma.seoDomainResearchTopPagesSnapshot.findFirst({
            where: snapshotWhere(scope),
            orderBy: { fetched_at: "desc" },
        })
    },

    createTopPages(input: SnapshotCreateInput & {
        itemLimit: number
        totalCount: number
    }) {
        return prisma.seoDomainResearchTopPagesSnapshot.create({
            data: {
                project_id: input.scope.projectId,
                requested_by_user_id: input.scope.userId,
                target_domain: input.scope.domain,
                location_code: input.scope.market.locationCode,
                country_iso_code: input.scope.market.countryIsoCode,
                language_code: input.scope.market.languageCode,
                item_limit: input.itemLimit,
                total_count: input.totalCount,
                payload: jsonPayload(input.payload),
                provider_environment: input.providerEnvironment,
                provider_cost_usd: input.providerCostUsd,
                provider_task_ids: input.providerTaskIds,
                expires_at: input.expiresAt,
            },
        })
    },

    findCompetitors(scope: DomainResearchScope) {
        return prisma.seoDomainResearchCompetitorSnapshot.findFirst({
            where: snapshotWhere(scope),
            orderBy: { fetched_at: "desc" },
        })
    },

    createCompetitors(input: SnapshotCreateInput & {
        itemLimit: number
        totalCount: number
    }) {
        return prisma.seoDomainResearchCompetitorSnapshot.create({
            data: {
                project_id: input.scope.projectId,
                requested_by_user_id: input.scope.userId,
                target_domain: input.scope.domain,
                location_code: input.scope.market.locationCode,
                country_iso_code: input.scope.market.countryIsoCode,
                language_code: input.scope.market.languageCode,
                item_limit: input.itemLimit,
                total_count: input.totalCount,
                payload: jsonPayload(input.payload),
                provider_environment: input.providerEnvironment,
                provider_cost_usd: input.providerCostUsd,
                provider_task_ids: input.providerTaskIds,
                expires_at: input.expiresAt,
            },
        })
    },

    findKeywordGap(scope: DomainResearchScope, competitorDomain: string) {
        return prisma.seoDomainResearchKeywordGapSnapshot.findFirst({
            where: {
                ...snapshotWhere(scope),
                competitor_domain: competitorDomain,
            },
            orderBy: { fetched_at: "desc" },
        })
    },

    createKeywordGap(input: SnapshotCreateInput & {
        competitorDomain: string
        itemLimit: number
    }) {
        return prisma.seoDomainResearchKeywordGapSnapshot.create({
            data: {
                project_id: input.scope.projectId,
                requested_by_user_id: input.scope.userId,
                target_domain: input.scope.domain,
                competitor_domain: input.competitorDomain,
                location_code: input.scope.market.locationCode,
                country_iso_code: input.scope.market.countryIsoCode,
                language_code: input.scope.market.languageCode,
                item_limit: input.itemLimit,
                payload: jsonPayload(input.payload),
                provider_environment: input.providerEnvironment,
                provider_cost_usd: input.providerCostUsd,
                provider_task_ids: input.providerTaskIds,
                expires_at: input.expiresAt,
            },
        })
    },

    async listOverviewSnapshots(projectId: string, page: number, pageSize: number) {
        const where = { project_id: projectId }
        const [snapshots, total] = await prisma.$transaction([
            prisma.seoDomainResearchOverviewSnapshot.findMany({
                where,
                orderBy: { fetched_at: "desc" },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.seoDomainResearchOverviewSnapshot.count({ where }),
        ])
        return { snapshots, total }
    },
}

export type DomainResearchSnapshotRecord = Awaited<
    ReturnType<typeof domainResearchRepository.findOverview>
>
