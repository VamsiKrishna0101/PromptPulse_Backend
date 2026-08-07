import { Prisma } from "@prisma/client"
import prisma from "../../../lib/prisma"
import type { RankDeviceMode, RankSchedule, RankSerpResult } from "./rank_tracking_types"

export async function listRankConfigs(projectId: string) {
    const configs = await prisma.seoRankTrackingConfig.findMany({
        where: { project_id: projectId, is_active: true },
        include: {
            _count: { select: { keywords: true } },
            runs: { orderBy: { started_at: "desc" }, take: 1 },
        },
        orderBy: { created_at: "asc" },
    })
    return configs.map(config => ({
        ...config,
        keyword_count: config._count.keywords,
        latest_run: config.runs[0] ?? null,
        _count: undefined,
        runs: undefined,
    }))
}

export function getRankConfig(projectId: string, configId: string) {
    return prisma.seoRankTrackingConfig.findFirst({
        where: { id: configId, project_id: projectId },
    })
}

export function findRankConfig(input: {
    projectId: string
    domain: string
    locationCode: number
    locationName: string | null
}) {
    return prisma.seoRankTrackingConfig.findFirst({
        where: {
            project_id: input.projectId,
            domain: input.domain,
            location_code: input.locationCode,
            location_name: input.locationName,
        },
    })
}

export function createRankConfig(input: {
    projectId: string
    domain: string
    locationCode: number
    locationName: string | null
    languageCode: string
    deviceMode: RankDeviceMode
    serpDepth: number
    scheduleInterval: RankSchedule
    nextCheckAt: Date | null
}) {
    return prisma.seoRankTrackingConfig.create({
        data: {
            project_id: input.projectId,
            domain: input.domain,
            location_code: input.locationCode,
            location_name: input.locationName,
            language_code: input.languageCode,
            device_mode: input.deviceMode,
            serp_depth: input.serpDepth,
            schedule_interval: input.scheduleInterval,
            next_check_at: input.nextCheckAt,
        },
    })
}

export function updateRankConfig(
    projectId: string,
    configId: string,
    data: Prisma.SeoRankTrackingConfigUpdateInput,
) {
    return prisma.seoRankTrackingConfig.update({
        where: { id: configId, project_id: projectId },
        data,
    })
}

export function listRankKeywords(configId: string) {
    return prisma.seoRankTrackingKeyword.findMany({
        where: { config_id: configId },
        orderBy: { created_at: "asc" },
    })
}

export async function addRankKeywords(configId: string, keywords: string[]) {
    const result = await prisma.seoRankTrackingKeyword.createMany({
        data: keywords.map(keyword => ({ config_id: configId, keyword })),
        skipDuplicates: true,
    })
    return result.count
}

export function removeRankKeywords(configId: string, keywordIds: string[]) {
    return prisma.seoRankTrackingKeyword.deleteMany({
        where: { config_id: configId, id: { in: keywordIds } },
    })
}

export function getActiveRankRun(configId: string) {
    return prisma.seoRankCheckRun.findFirst({
        where: { config_id: configId, status: { in: ["PENDING", "RUNNING"] } },
        orderBy: { started_at: "desc" },
    })
}

export function createRankRun(input: {
    configId: string
    projectId: string
    keywordsTotal: number
    isSubsetRun: boolean
    providerMode?: string
}) {
    return prisma.seoRankCheckRun.create({
        data: {
            config_id: input.configId,
            project_id: input.projectId,
            keywords_total: input.keywordsTotal,
            is_subset_run: input.isSubsetRun,
            provider_mode: input.providerMode ?? "standard",
        },
    })
}

export function updateRankRun(
    runId: string,
    data: Prisma.SeoRankCheckRunUpdateInput,
) {
    return prisma.seoRankCheckRun.update({ where: { id: runId }, data })
}

export async function saveRankSnapshots(input: {
    runId: string
    results: RankSerpResult[]
}) {
    const previous = await prisma.seoRankSnapshot.findMany({
        where: {
            tracking_keyword_id: { in: input.results.map(row => row.trackingKeywordId) },
            device: { in: [...new Set(input.results.map(row => row.device))] },
        },
        orderBy: { checked_at: "desc" },
    })
    const previousByKey = new Map<string, number | null>()
    for (const row of previous) {
        const key = `${row.tracking_keyword_id}:${row.device}`
        if (!previousByKey.has(key)) previousByKey.set(key, row.position)
    }

    await prisma.seoRankSnapshot.createMany({
        data: input.results.map(row => ({
            run_id: input.runId,
            tracking_keyword_id: row.trackingKeywordId,
            keyword: row.keyword,
            device: row.device,
            position: row.position,
            previous_position: previousByKey.get(`${row.trackingKeywordId}:${row.device}`) ?? null,
            ranking_url: row.rankingUrl,
            serp_features: row.serpFeatures,
        })),
        skipDuplicates: true,
    })
}

export function getLatestRankRun(configId: string) {
    return prisma.seoRankCheckRun.findFirst({
        where: { config_id: configId },
        include: { snapshots: true },
        orderBy: { started_at: "desc" },
    })
}

export function getRankKeywordHistory(
    configId: string,
    trackingKeywordId: string,
    since: Date,
) {
    return prisma.seoRankSnapshot.findMany({
        where: {
            tracking_keyword_id: trackingKeywordId,
            tracking_keyword: { config_id: configId },
            checked_at: { gte: since },
        },
        orderBy: { checked_at: "asc" },
    })
}

export function getRankPositionMatrix(configId: string, device: string, runLimit: number) {
    return prisma.seoRankCheckRun.findMany({
        where: { config_id: configId, status: { in: ["COMPLETED", "PARTIAL"] } },
        include: { snapshots: { where: { device } } },
        orderBy: { started_at: "desc" },
        take: runLimit,
    })
}
