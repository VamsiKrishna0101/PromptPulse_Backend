import { Prisma } from "@prisma/client"
import { assertProjectAccess } from "../../projects/project_access"
import { normalizeDomain } from "../shared/seo_domain"
import {
    assertSeoCreditsAvailable,
    chargeSeoProviderCost,
    refundSeoProviderCharge,
} from "../shared/seo_credits"
import { SeoError } from "../shared/seo_errors"
import { postRankTasks } from "./rank_tracking_provider"
import { processStandardRankRun } from "./rank_tracking_worker"
import { serpStandardCredits, serpStandardEstimate } from "../shared/seo_pricing"
import {
    addRankKeywords,
    createRankConfig,
    createRankRun,
    findRankConfig,
    getActiveRankRun,
    getLatestRankRun,
    getRankConfig,
    getRankKeywordHistory,
    getRankPositionMatrix,
    listRankConfigs,
    listRankKeywords,
    removeRankKeywords,
    saveRankSnapshots,
    updateRankConfig,
    updateRankRun,
} from "./rank_tracking_repository"
import type {
    RankDevice,
    RankDeviceMode,
    RankProviderResult,
    RankSchedule,
} from "./rank_tracking_types"

const MAX_CONFIGS_PER_PROJECT = 20
const MAX_KEYWORDS_PER_CONFIG = 500
const PROVIDER_CONCURRENCY = 5

function nextCheckAt(schedule: RankSchedule, from = new Date()): Date | null {
    if (schedule === "manual") return null
    const next = new Date(from)
    if (schedule === "daily") next.setUTCDate(next.getUTCDate() + 1)
    if (schedule === "weekly") next.setUTCDate(next.getUTCDate() + 7)
    if (schedule === "monthly") next.setUTCMonth(next.getUTCMonth() + 1)
    return next
}

function environment() {
    return process.env.DATAFORSEO_ENV?.trim().toLowerCase() === "sandbox"
        ? "sandbox" as const
        : "production" as const
}

function devices(mode: RankDeviceMode): RankDevice[] {
    return mode === "both" ? ["desktop", "mobile"] : [mode]
}

async function requireConfig(projectId: string, userId: string, configId: string) {
    await assertProjectAccess(projectId, userId)
    const config = await getRankConfig(projectId, configId)
    if (!config) {
        throw new SeoError("SEO_PROJECT_NOT_FOUND", "Rank tracking configuration not found", 404)
    }
    return config
}

async function mapLimit<T, R>(
    values: T[],
    limit: number,
    worker: (value: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
    const output: PromiseSettledResult<R>[] = new Array(values.length)
    let cursor = 0
    async function consume() {
        while (cursor < values.length) {
            const index = cursor
            cursor += 1
            try {
                output[index] = { status: "fulfilled", value: await worker(values[index]) }
            } catch (reason) {
                output[index] = { status: "rejected", reason }
            }
        }
    }
    await Promise.all(
        Array.from({ length: Math.min(limit, values.length) }, () => consume()),
    )
    return output
}

export async function listConfigs(input: { projectId: string; userId: string }) {
    await assertProjectAccess(input.projectId, input.userId)
    return { configs: await listRankConfigs(input.projectId) }
}

export async function createConfig(input: {
    projectId: string
    userId: string
    domain: string
    locationCode: number
    locationName?: string | null
    languageCode: string
    deviceMode: RankDeviceMode
    serpDepth: number
    scheduleInterval: RankSchedule
}) {
    await assertProjectAccess(input.projectId, input.userId)
    const domain = normalizeDomain(input.domain)
    const locationName = input.locationName?.trim() || null
    const existing = await findRankConfig({
        projectId: input.projectId,
        domain,
        locationCode: input.locationCode,
        locationName,
    })
    if (existing?.is_active) {
        throw new SeoError(
            "SEO_CONFLICT",
            "This domain and search location are already tracked",
            409,
        )
    }
    const configs = await listRankConfigs(input.projectId)
    if (configs.length >= MAX_CONFIGS_PER_PROJECT) {
        throw new SeoError(
            "SEO_VALIDATION_ERROR",
            `A project can track up to ${MAX_CONFIGS_PER_PROJECT} domain locations`,
            400,
        )
    }
    if (existing) {
        return updateRankConfig(input.projectId, existing.id, {
            is_active: true,
            language_code: input.languageCode,
            device_mode: input.deviceMode,
            serp_depth: input.serpDepth,
            schedule_interval: input.scheduleInterval,
            next_check_at: nextCheckAt(input.scheduleInterval),
            last_skip_reason: null,
        })
    }
    return createRankConfig({
        projectId: input.projectId,
        domain,
        locationCode: input.locationCode,
        locationName,
        languageCode: input.languageCode,
        deviceMode: input.deviceMode,
        serpDepth: input.serpDepth,
        scheduleInterval: input.scheduleInterval,
        nextCheckAt: nextCheckAt(input.scheduleInterval),
    })
}

export async function updateConfig(input: {
    projectId: string
    userId: string
    configId: string
    domain?: string
    locationCode?: number
    locationName?: string | null
    languageCode?: string
    deviceMode?: RankDeviceMode
    serpDepth?: number
    scheduleInterval?: RankSchedule
    isActive?: boolean
}) {
    await requireConfig(input.projectId, input.userId, input.configId)
    const data: Prisma.SeoRankTrackingConfigUpdateInput = {}
    if (input.domain !== undefined) data.domain = normalizeDomain(input.domain)
    if (input.locationCode !== undefined) data.location_code = input.locationCode
    if (input.locationName !== undefined) data.location_name = input.locationName?.trim() || null
    if (input.languageCode !== undefined) data.language_code = input.languageCode
    if (input.deviceMode !== undefined) data.device_mode = input.deviceMode
    if (input.serpDepth !== undefined) data.serp_depth = input.serpDepth
    if (input.isActive !== undefined) data.is_active = input.isActive
    if (input.scheduleInterval !== undefined) {
        data.schedule_interval = input.scheduleInterval
        data.next_check_at = nextCheckAt(input.scheduleInterval)
    }
    return updateRankConfig(input.projectId, input.configId, data)
}

export async function getKeywords(input: {
    projectId: string
    userId: string
    configId: string
}) {
    await requireConfig(input.projectId, input.userId, input.configId)
    return { keywords: await listRankKeywords(input.configId) }
}

export async function addKeywords(input: {
    projectId: string
    userId: string
    configId: string
    keywords: string[]
}) {
    await requireConfig(input.projectId, input.userId, input.configId)
    const existing = await listRankKeywords(input.configId)
    const known = new Set(existing.map(row => row.keyword.toLowerCase()))
    const normalized = [...new Set(
        input.keywords
            .map(keyword => keyword.trim().toLowerCase())
            .filter(keyword => keyword.length > 0 && keyword.length <= 200),
    )].filter(keyword => !known.has(keyword))
    const available = Math.max(0, MAX_KEYWORDS_PER_CONFIG - existing.length)
    if (available === 0) {
        throw new SeoError(
            "SEO_VALIDATION_ERROR",
            `This tracker already has the maximum ${MAX_KEYWORDS_PER_CONFIG} keywords`,
            400,
        )
    }
    const added = await addRankKeywords(input.configId, normalized.slice(0, available))
    return { added, total: existing.length + added }
}

export async function removeKeywords(input: {
    projectId: string
    userId: string
    configId: string
    keywordIds: string[]
}) {
    await requireConfig(input.projectId, input.userId, input.configId)
    const result = await removeRankKeywords(input.configId, input.keywordIds)
    return { removed: result.count }
}

export async function estimateRun(input: {
    projectId: string
    userId: string
    configId: string
    keywordIds?: string[]
}) {
    const config = await requireConfig(input.projectId, input.userId, input.configId)
    const keywords = await listRankKeywords(input.configId)
    const selected = input.keywordIds?.length
        ? keywords.filter(row => input.keywordIds?.includes(row.id))
        : keywords
    const trackedDevices = devices(config.device_mode as RankDeviceMode)
    const requestCount = selected.length * trackedDevices.length
    const estimatedCostUsd = serpStandardEstimate({
        tasks: requestCount,
        depth: config.serp_depth,
        sandbox: environment() === "sandbox",
    })
    const estimatedCredits = serpStandardCredits({
        tasks: requestCount,
        depth: config.serp_depth,
        sandbox: environment() === "sandbox",
        creditsPerUsd: 1000,
        markup: Number(process.env.SEO_DATA_COST_MARKUP || 1.28),
    })
    return {
        keywords: selected.length,
        devices: trackedDevices,
        provider_requests: requestCount,
        provider_mode: "standard_normal",
        estimated_cost_usd: estimatedCostUsd,
        estimated_max_credits: estimatedCredits,
    }
}

export async function runCheck(input: {
    projectId: string
    userId: string
    configId: string
    keywordIds?: string[]
}) {
    const config = await requireConfig(input.projectId, input.userId, input.configId)
    const active = await getActiveRankRun(config.id)
    if (active) {
        throw new SeoError("SEO_CONFLICT", "A rank check is already running", 409, {
            run_id: active.id,
        })
    }
    const allKeywords = await listRankKeywords(config.id)
    const keywords = input.keywordIds?.length
        ? allKeywords.filter(row => input.keywordIds?.includes(row.id))
        : allKeywords
    if (!keywords.length) {
        throw new SeoError(
            "SEO_VALIDATION_ERROR",
            "Add at least one tracked keyword before running a rank check",
            400,
        )
    }
    const trackedDevices = devices(config.device_mode as RankDeviceMode)
    const tasks = keywords.flatMap(keyword =>
        trackedDevices.map(device => ({ keyword, device })),
    )
    const estimatedCredits = serpStandardCredits({
        tasks: tasks.length,
        depth: config.serp_depth,
        sandbox: environment() === "sandbox",
        creditsPerUsd: 1000,
        markup: Number(process.env.SEO_DATA_COST_MARKUP || 1.28),
    })
    await assertSeoCreditsAvailable(input.userId, estimatedCredits)

    let run
    try {
        run = await createRankRun({
            configId: config.id,
            projectId: input.projectId,
            keywordsTotal: keywords.length,
            isSubsetRun: Boolean(input.keywordIds?.length),
            providerMode: "standard",
        })
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new SeoError("SEO_CONFLICT", "A rank check is already running", 409)
        }
        throw error
    }

    let providerTasks
    try {
        providerTasks = await postRankTasks(tasks.map(task => ({
            keyword: task.keyword.keyword,
            locationCode: config.location_code,
            locationName: config.location_name,
            languageCode: config.language_code,
            device: task.device,
            depth: config.serp_depth,
            targetDomain: config.domain,
        })))
    } catch (error) {
        await updateRankRun(run.id, { status: "FAILED", error_message: error instanceof Error ? error.message : "Could not create provider tasks", completed_at: new Date() })
        throw error
    }
    if (providerTasks.taskIds.length !== tasks.length) {
        await updateRankRun(run.id, { status: "FAILED", error_message: "DataForSEO returned an incomplete task list", completed_at: new Date() })
        throw new SeoError("DATAFORSEO_UPSTREAM_ERROR", "DataForSEO returned an incomplete task list", 502)
    }
    let charge
    try {
        charge = await chargeSeoProviderCost({
            userId: input.userId,
            projectId: input.projectId,
            operation: "rank_tracking_check",
            costUsd: providerTasks.costUsd,
            environment: environment(),
            taskIds: providerTasks.taskIds,
        })
    } catch (error) {
        await updateRankRun(run.id, { status: "FAILED", error_message: error instanceof Error ? error.message : "Could not charge provider cost", completed_at: new Date() })
        throw error
    }
    const taskMap = providerTasks.taskIds.map((taskId, index) => ({
        taskId,
        trackingKeywordId: tasks[index]?.keyword.id,
        keyword: tasks[index]?.keyword.keyword,
        device: tasks[index]?.device,
    }))
    await updateRankRun(run.id, {
        status: "RUNNING",
        credits_spent: charge.credits,
        provider_task_ids: providerTasks.taskIds,
        provider_task_map: taskMap,
    })
    void processStandardRankRun({
        runId: run.id,
        projectId: input.projectId,
        userId: input.userId,
        domain: config.domain,
        configId: config.id,
        nextCheckAt: nextCheckAt(config.schedule_interval as RankSchedule),
    }).catch(async error => {
        console.error("[seo.rank-tracking] standard task worker failed", error)
        await updateRankRun(run.id, { status: "FAILED", error_message: error instanceof Error ? error.message : "Rank task worker failed", completed_at: new Date() })
    })
    return {
        run_id: run.id,
        status: "RUNNING",
        provider_mode: "standard",
        provider_requests: tasks.length,
        provider_task_ids: providerTasks.taskIds,
        credits_spent: charge.credits,
        estimated_cost_usd: serpStandardEstimate({ tasks: tasks.length, depth: config.serp_depth, sandbox: environment() === "sandbox" }),
        estimated_credits: estimatedCredits,
    }
}

export async function latestResults(input: {
    projectId: string
    userId: string
    configId: string
}) {
    await requireConfig(input.projectId, input.userId, input.configId)
    const [run, keywords] = await Promise.all([
        getLatestRankRun(input.configId),
        listRankKeywords(input.configId),
    ])
    if (!run) return { run: null, rows: [] }
    const snapshotsByKeyword = new Map<string, typeof run.snapshots>()
    for (const snapshot of run.snapshots) {
        const list = snapshotsByKeyword.get(snapshot.tracking_keyword_id) ?? []
        list.push(snapshot)
        snapshotsByKeyword.set(snapshot.tracking_keyword_id, list)
    }
    return {
        run: {
            id: run.id,
            status: run.status,
            started_at: run.started_at,
            completed_at: run.completed_at,
            keywords_checked: run.keywords_checked,
            keywords_total: run.keywords_total,
            credits_spent: run.credits_spent,
        },
        rows: keywords.map(keyword => {
            const snapshots = snapshotsByKeyword.get(keyword.id) ?? []
            const device = (name: RankDevice) => {
                const row = snapshots.find(snapshot => snapshot.device === name)
                return row ? {
                    position: row.position,
                    previous_position: row.previous_position,
                    ranking_url: row.ranking_url,
                    serp_features: row.serp_features,
                } : null
            }
            return {
                id: keyword.id,
                keyword: keyword.keyword,
                search_volume: keyword.search_volume,
                keyword_difficulty: keyword.keyword_difficulty,
                cpc: keyword.cpc,
                desktop: device("desktop"),
                mobile: device("mobile"),
            }
        }),
    }
}

export async function keywordHistory(input: {
    projectId: string
    userId: string
    configId: string
    keywordId: string
    sinceDays: number
}) {
    await requireConfig(input.projectId, input.userId, input.configId)
    const since = new Date(Date.now() - input.sinceDays * 24 * 60 * 60 * 1000)
    return {
        history: await getRankKeywordHistory(input.configId, input.keywordId, since),
    }
}

export async function positionMatrix(input: {
    projectId: string
    userId: string
    configId: string
    device: RankDevice
    runLimit: number
}) {
    await requireConfig(input.projectId, input.userId, input.configId)
    const runs = await getRankPositionMatrix(input.configId, input.device, input.runLimit)
    return {
        runs: [...runs].reverse().map(run => ({
            id: run.id,
            checked_at: run.completed_at ?? run.started_at,
            snapshots: run.snapshots.map(snapshot => ({
                keyword_id: snapshot.tracking_keyword_id,
                keyword: snapshot.keyword,
                position: snapshot.position,
                ranking_url: snapshot.ranking_url,
            })),
        })),
    }
}

export const rankTrackingService = {
    listConfigs,
    createConfig,
    updateConfig,
    getKeywords,
    addKeywords,
    removeKeywords,
    estimateRun,
    runCheck,
    latestResults,
    keywordHistory,
    positionMatrix,
}
