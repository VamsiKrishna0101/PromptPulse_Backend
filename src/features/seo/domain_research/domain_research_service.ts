import { assertProjectAccess } from "../../projects/project_access"
import { normalizeDomain } from "../shared/seo_domain"
import {
    assertSeoCreditsAvailable,
    chargeSeoProviderCost,
    refundSeoProviderCharge,
} from "../shared/seo_credits"
import { SeoError } from "../shared/seo_errors"
import { resolveSeoMarket } from "../shared/seo_market"
import {
    fetchCompetitors,
    fetchKeywordGap,
    fetchOrganicKeywords,
    fetchOverview,
    fetchTopPages,
} from "./domain_research_provider"
import { domainResearchRepository } from "./domain_research_repository"
import { buildSiteStructure } from "./site_structure_builder"
import type {
    CompetitorsLimit,
    DomainResearchTarget,
    DomainResearchRange,
    DomainResearchScope,
    KeywordGapLimit,
    OrganicKeywordsLimit,
    ProviderResult,
    TopPagesLimit,
} from "./domain_research_types"

const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as JsonRecord
        : {}
}

function expiresAt() {
    return new Date(Date.now() + SNAPSHOT_TTL_MS)
}

function snapshotStatus(expiry: Date) {
    return expiry.getTime() > Date.now() ? "HIT" as const : "STALE" as const
}

function withSnapshot(
    payload: unknown,
    snapshot: {
        id: string
        fetched_at: Date
        expires_at: Date
        item_limit?: number
    },
    cacheStatus: "HIT" | "STALE" | "REFRESHED",
    extra: Record<string, unknown> = {},
) {
    return {
        ...record(payload),
        snapshot: {
            id: snapshot.id,
            fetchedAt: snapshot.fetched_at.toISOString(),
            expiresAt: snapshot.expires_at.toISOString(),
            cacheStatus,
            ...extra,
        },
    }
}

async function scopeFor(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
}): Promise<DomainResearchScope> {
    await assertProjectAccess(input.projectId, input.userId)
    return {
        projectId: input.projectId,
        userId: input.userId,
        domain: normalizeDomain(input.domain),
        market: resolveSeoMarket(input.country, input.languageCode),
    }
}

async function preflight(scope: DomainResearchScope, estimate: number) {
    const environment =
        process.env.DATAFORSEO_ENV?.trim().toLowerCase() === "sandbox"
            ? "sandbox"
            : "production"
    await assertSeoCreditsAvailable(scope.userId, environment === "sandbox" ? 0 : estimate)
}

async function charge<T>(
    scope: DomainResearchScope,
    operation: string,
    result: ProviderResult<T>,
) {
    return chargeSeoProviderCost({
        userId: scope.userId,
        projectId: scope.projectId,
        operation,
        costUsd: result.costUsd,
        environment: result.environment,
        taskIds: result.taskIds,
    })
}

async function persistSafely<T>(
    scope: DomainResearchScope,
    operation: string,
    result: ProviderResult<T>,
    persist: () => Promise<unknown>,
) {
    const charged = await charge(scope, operation, result)
    try {
        return await persist()
    } catch (error) {
        await refundSeoProviderCharge({
            userId: scope.userId,
            projectId: scope.projectId,
            operation,
            credits: charged.credits,
            idempotencyKey: charged.idempotencyKey,
        })
        throw error
    }
}

function missingSnapshot(name: string): never {
    throw new SeoError(
        "SEO_SNAPSHOT_NOT_FOUND",
        `No ${name} snapshot exists yet. Run a refresh first.`,
        404,
    )
}

export async function getOverview(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
    range: DomainResearchRange
}) {
    const scope = await scopeFor(input)
    const snapshot = await domainResearchRepository.findOverview(scope, input.range)
    if (!snapshot) return missingSnapshot("domain overview")
    return withSnapshot(
        snapshot.payload,
        snapshot,
        snapshotStatus(snapshot.expires_at),
        { requestedRangeMonths: input.range },
    )
}

export async function refreshOverview(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
    range: DomainResearchRange
}) {
    const scope = await scopeFor(input)
    await preflight(scope, 200)
    const result = await fetchOverview(scope, input.range)
    const expiry = expiresAt()
    const created = await persistSafely(scope, "domain_overview", result, () =>
        domainResearchRepository.createOverview({
            scope,
            historyMonths: input.range,
            payload: result.payload as unknown as JsonRecord,
            providerEnvironment: result.environment,
            providerCostUsd: result.costUsd,
            providerTaskIds: result.taskIds,
            expiresAt: expiry,
        }),
    ) as Awaited<ReturnType<typeof domainResearchRepository.createOverview>>
    return withSnapshot(result.payload, created, "REFRESHED", {
        requestedRangeMonths: input.range,
    })
}

export async function getOrganicKeywordsSnapshot(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
}) {
    const scope = await scopeFor(input)
    const snapshot = await domainResearchRepository.findOrganicKeywords(scope)
    if (!snapshot) return missingSnapshot("organic keywords")
    return withSnapshot(snapshot.payload, snapshot, snapshotStatus(snapshot.expires_at), {
        itemLimit: snapshot.item_limit,
    })
}

export async function refreshOrganicKeywordsSnapshot(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
    limit: OrganicKeywordsLimit
}) {
    const scope = await scopeFor(input)
    await preflight(scope, Math.max(50, Math.ceil(input.limit / 5)))
    const result = await fetchOrganicKeywords(scope, input.limit)
    const expiry = expiresAt()
    const created = await persistSafely(scope, "organic_keywords", result, () =>
        domainResearchRepository.createOrganicKeywords({
            scope,
            itemLimit: input.limit,
            totalCount: result.payload.summary.totalKeywords,
            payload: result.payload as unknown as JsonRecord,
            providerEnvironment: result.environment,
            providerCostUsd: result.costUsd,
            providerTaskIds: result.taskIds,
            expiresAt: expiry,
        }),
    ) as Awaited<ReturnType<typeof domainResearchRepository.createOrganicKeywords>>
    return withSnapshot(result.payload, created, "REFRESHED", {
        itemLimit: input.limit,
    })
}

export async function getTopPagesSnapshot(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
}) {
    const scope = await scopeFor(input)
    const snapshot = await domainResearchRepository.findTopPages(scope)
    if (!snapshot) return missingSnapshot("top pages")
    return withSnapshot(snapshot.payload, snapshot, snapshotStatus(snapshot.expires_at), {
        itemLimit: snapshot.item_limit,
    })
}

export async function refreshTopPagesSnapshot(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
    limit: TopPagesLimit
}) {
    const scope = await scopeFor(input)
    await preflight(scope, Math.max(40, Math.ceil(input.limit / 5)))
    const result = await fetchTopPages(scope, input.limit)
    const created = await persistSafely(scope, "top_pages", result, () =>
        domainResearchRepository.createTopPages({
            scope,
            itemLimit: input.limit,
            totalCount: result.payload.summary.totalPages,
            payload: result.payload as unknown as JsonRecord,
            providerEnvironment: result.environment,
            providerCostUsd: result.costUsd,
            providerTaskIds: result.taskIds,
            expiresAt: expiresAt(),
        }),
    ) as Awaited<ReturnType<typeof domainResearchRepository.createTopPages>>
    return withSnapshot(result.payload, created, "REFRESHED", {
        itemLimit: input.limit,
    })
}

export async function getCompetitorsSnapshot(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
}) {
    const scope = await scopeFor(input)
    const snapshot = await domainResearchRepository.findCompetitors(scope)
    if (!snapshot) return missingSnapshot("organic competitors")
    return withSnapshot(snapshot.payload, snapshot, snapshotStatus(snapshot.expires_at), {
        itemLimit: snapshot.item_limit,
    })
}

export async function refreshCompetitorsSnapshot(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
    limit: CompetitorsLimit
}) {
    const scope = await scopeFor(input)
    await preflight(scope, Math.max(50, input.limit))
    const keywordSnapshot = await domainResearchRepository.findOrganicKeywords(scope)
    const targetKeywordCount = keywordSnapshot?.total_count ?? 0
    const result = await fetchCompetitors(scope, input.limit, targetKeywordCount)
    const created = await persistSafely(scope, "organic_competitors", result, () =>
        domainResearchRepository.createCompetitors({
            scope,
            itemLimit: input.limit,
            totalCount: result.payload.summary.totalCompetitors,
            payload: result.payload as unknown as JsonRecord,
            providerEnvironment: result.environment,
            providerCostUsd: result.costUsd,
            providerTaskIds: result.taskIds,
            expiresAt: expiresAt(),
        }),
    ) as Awaited<ReturnType<typeof domainResearchRepository.createCompetitors>>
    return withSnapshot(result.payload, created, "REFRESHED", {
        itemLimit: input.limit,
    })
}

export async function getKeywordGapSnapshot(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
    competitorDomain: string
}) {
    const scope = await scopeFor(input)
    const competitorDomain = normalizeDomain(input.competitorDomain)
    const snapshot = await domainResearchRepository.findKeywordGap(scope, competitorDomain)
    if (!snapshot) return missingSnapshot("keyword gap")
    return withSnapshot(snapshot.payload, snapshot, snapshotStatus(snapshot.expires_at), {
        itemLimit: snapshot.item_limit,
    })
}

export async function refreshKeywordGapSnapshot(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
    competitorDomain: string
    limit: KeywordGapLimit
}) {
    const scope = await scopeFor(input)
    const competitorDomain = normalizeDomain(input.competitorDomain)
    if (competitorDomain === scope.domain) {
        throw new SeoError(
            "SEO_VALIDATION_ERROR",
            "Choose a competitor domain different from the researched domain",
            400,
        )
    }
    await preflight(scope, Math.max(100, input.limit))
    const result = await fetchKeywordGap(scope, competitorDomain, input.limit)
    const created = await persistSafely(scope, "keyword_gap", result, () =>
        domainResearchRepository.createKeywordGap({
            scope,
            competitorDomain,
            itemLimit: input.limit,
            payload: result.payload as unknown as JsonRecord,
            providerEnvironment: result.environment,
            providerCostUsd: result.costUsd,
            providerTaskIds: result.taskIds,
            expiresAt: expiresAt(),
        }),
    ) as Awaited<ReturnType<typeof domainResearchRepository.createKeywordGap>>
    return withSnapshot(result.payload, created, "REFRESHED", {
        itemLimit: input.limit,
    })
}

export async function getSiteStructureSnapshot(input: {
    projectId: string
    userId: string
    domain: string
    country: string
    languageCode: string
}) {
    const scope = await scopeFor(input)
    const [keywords, topPages] = await Promise.all([
        domainResearchRepository.findOrganicKeywords(scope),
        domainResearchRepository.findTopPages(scope),
    ])
    if (!keywords && !topPages) return missingSnapshot("site structure source")
    const payload = record(keywords?.payload)
    const target = record(payload.target ?? record(topPages?.payload).target)
    return buildSiteStructure({
        target: target as DomainResearchTarget,
        keywordsPayload: keywords ? record(keywords.payload) : null,
        keywordSnapshotId: keywords?.id ?? null,
        keywordLimit: keywords?.item_limit ?? null,
        topPagesPayload: topPages ? record(topPages.payload) : null,
        topPagesSnapshotId: topPages?.id ?? null,
        topPagesLimit: topPages?.item_limit ?? null,
        fetchedAt: new Date(Math.max(
            keywords?.fetched_at.getTime() ?? 0,
            topPages?.fetched_at.getTime() ?? 0,
        )),
    })
}

export async function listOverviewSnapshots(input: {
    projectId: string
    userId: string
    page: number
    pageSize: number
}) {
    await assertProjectAccess(input.projectId, input.userId)
    const { snapshots, total } = await domainResearchRepository.listOverviewSnapshots(
        input.projectId,
        input.page,
        input.pageSize,
    )
    return {
        snapshots: snapshots.map(snapshot => {
            const payload = record(snapshot.payload)
            const summary = record(payload.summary)
            const organic = record(summary.organic)
            const target = record(payload.target)
            return {
                id: snapshot.id,
                targetDomain: snapshot.target_domain,
                locationCode: snapshot.location_code,
                countryIsoCode: snapshot.country_iso_code,
                languageCode: snapshot.language_code,
                historyMonths: snapshot.history_months,
                fetchedAt: snapshot.fetched_at.toISOString(),
                expiresAt: snapshot.expires_at.toISOString(),
                organicTraffic: Number(organic.traffic ?? 0),
                organicKeywords: Number(organic.keywords ?? 0),
                trafficValueUsd: Number(organic.trafficValueUsd ?? 0),
                locationName: String(target.locationName ?? snapshot.country_iso_code),
            }
        }),
        total,
        page: input.page,
        page_size: input.pageSize,
        total_pages: Math.max(1, Math.ceil(total / input.pageSize)),
    }
}
