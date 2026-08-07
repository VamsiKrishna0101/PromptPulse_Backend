import { assertProjectAccess } from "../../projects/project_access"
import { normalizeDomain } from "../shared/seo_domain"
import { assertSeoCreditsAvailable } from "../shared/seo_credits"
import {
    persistProviderSnapshot,
    readProviderSnapshot,
    seoScopeKey,
} from "../shared/seo_snapshot_service"
import {
    fetchBacklinksReport,
    fetchBacklinkTopPagesPage,
    fetchBacklinksOverview,
    fetchBacklinksPage,
    fetchReferringDomainsPage,
} from "./backlinks_provider"
import type { BacklinksReportMode } from "./backlinks_provider"
import { seoSnapshotRepository } from "../shared/seo_snapshot_repository"

type BaseInput = {
    projectId: string
    userId: string
    target: string
    scope: "domain" | "page"
}

type PageInput = BaseInput & {
    page: number
    pageSize: 50 | 100 | 200
    sortOrder: "asc" | "desc"
    mode: "one_per_domain" | "as_is"
}

type ReportInput = BaseInput & {
    reportMode: BacklinksReportMode
}

function normalizeTarget(target: string, scope: "domain" | "page") {
    if (scope === "domain") return normalizeDomain(target)
    try {
        const url = new URL(target)
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("invalid protocol")
        return url.toString()
    } catch {
        return `https://${normalizeDomain(target)}/`
    }
}

function providerEnvironment() {
    return process.env.DATAFORSEO_ENV?.trim().toLowerCase() === "sandbox"
        ? "sandbox"
        : "production"
}

async function baseScope(input: BaseInput) {
    await assertProjectAccess(input.projectId, input.userId)
    return {
        target: normalizeTarget(input.target, input.scope),
        scope: input.scope,
    }
}

export async function getBacklinksOverview(input: BaseInput) {
    const value = await baseScope(input)
    return readProviderSnapshot({
        projectId: input.projectId,
        feature: "BACKLINKS_OVERVIEW",
        scopeKey: seoScopeKey(value),
        label: "backlinks overview",
    })
}

export async function refreshBacklinksOverview(input: BaseInput) {
    const value = await baseScope(input)
    await assertSeoCreditsAvailable(
        input.userId,
        providerEnvironment() === "sandbox" ? 0 : 200,
    )
    const result = await fetchBacklinksOverview(value)
    return persistProviderSnapshot({
        projectId: input.projectId,
        userId: input.userId,
        feature: "BACKLINKS_OVERVIEW",
        operation: "backlinks_overview",
        scopeKey: seoScopeKey(value),
        result,
        ttlMs: 24 * 60 * 60 * 1000,
    })
}

function reportScope(value: { target: string; scope: "domain" | "page" }, reportMode: BacklinksReportMode) {
    return { ...value, reportMode }
}

export async function getBacklinksReport(input: ReportInput) {
    const value = await baseScope(input)
    return readProviderSnapshot({
        projectId: input.projectId,
        feature: "BACKLINKS_REPORT",
        scopeKey: seoScopeKey(reportScope(value, input.reportMode)),
        label: `${input.reportMode} backlinks report`,
    })
}

export async function refreshBacklinksReport(input: ReportInput) {
    const value = await baseScope(input)
    await assertSeoCreditsAvailable(
        input.userId,
        providerEnvironment() === "sandbox" ? 0 : input.reportMode === "detailed" ? 300 : 180,
    )
    const result = await fetchBacklinksReport({ ...value, reportMode: input.reportMode })
    return persistProviderSnapshot({
        projectId: input.projectId,
        userId: input.userId,
        feature: "BACKLINKS_REPORT",
        operation: `backlinks_report_${input.reportMode}`,
        scopeKey: seoScopeKey(reportScope(value, input.reportMode)),
        result,
        ttlMs: 24 * 60 * 60 * 1000,
    })
}

export async function listBacklinksReports(input: { projectId: string; userId: string }) {
    await assertProjectAccess(input.projectId, input.userId)
    const snapshots = await seoSnapshotRepository.findRecentByFeature({
        projectId: input.projectId,
        feature: "BACKLINKS_REPORT",
        limit: 50,
    })
    const seen = new Set<string>()
    const reports: Array<Record<string, unknown>> = []
    for (const snapshot of snapshots) {
        const payload = snapshot.payload && typeof snapshot.payload === "object"
            ? snapshot.payload as Record<string, unknown>
            : {}
        const target = typeof payload.target === "string" ? payload.target : null
        const reportMode = payload.reportMode === "detailed" ? "detailed" : "normal"
        const scope = payload.scope === "page" ? "page" : "domain"
        if (!target) continue
        const key = `${target}:${scope}:${reportMode}`
        if (seen.has(key)) continue
        seen.add(key)
        const summary = payload.summary && typeof payload.summary === "object"
            ? payload.summary as Record<string, unknown>
            : {}
        reports.push({
            id: snapshot.id,
            target,
            scope,
            reportMode,
            rank: summary.rank ?? null,
            backlinks: summary.backlinks ?? null,
            referringDomains: summary.referringDomains ?? null,
            fetchedAt: snapshot.fetched_at.toISOString(),
        })
    }
    return { reports, total: reports.length }
}

function pageScope(value: { target: string; scope: "domain" | "page" }, input: PageInput) {
    return {
        ...value,
        page: input.page,
        pageSize: input.pageSize,
        sortOrder: input.sortOrder,
        mode: input.mode,
    }
}

async function getPage(input: PageInput, kind: "backlinks" | "domains" | "pages") {
    const value = await baseScope(input)
    return readProviderSnapshot({
        projectId: input.projectId,
        feature: `BACKLINKS_${kind.toUpperCase()}`,
        scopeKey: seoScopeKey(pageScope(value, input)),
        label: `backlinks ${kind}`,
    })
}

async function refreshPage(input: PageInput, kind: "backlinks" | "domains" | "pages") {
    const value = await baseScope(input)
    await assertSeoCreditsAvailable(
        input.userId,
        providerEnvironment() === "sandbox" ? 0 : Math.max(50, input.pageSize),
    )
    const providerInput = { ...value, ...pageScope(value, input) }
    const result =
        kind === "backlinks"
            ? await fetchBacklinksPage(providerInput)
            : kind === "domains"
                ? await fetchReferringDomainsPage(providerInput)
                : await fetchBacklinkTopPagesPage(providerInput)
    return persistProviderSnapshot({
        projectId: input.projectId,
        userId: input.userId,
        feature: `BACKLINKS_${kind.toUpperCase()}`,
        operation: `backlinks_${kind}`,
        scopeKey: seoScopeKey(pageScope(value, input)),
        result,
        ttlMs: 12 * 60 * 60 * 1000,
    })
}

export const backlinksService = {
    listReports: listBacklinksReports,
    getReport: getBacklinksReport,
    refreshReport: refreshBacklinksReport,
    getOverview: getBacklinksOverview,
    refreshOverview: refreshBacklinksOverview,
    getBacklinks: (input: PageInput) => getPage(input, "backlinks"),
    refreshBacklinks: (input: PageInput) => refreshPage(input, "backlinks"),
    getReferringDomains: (input: PageInput) => getPage(input, "domains"),
    refreshReferringDomains: (input: PageInput) => refreshPage(input, "domains"),
    getTopPages: (input: PageInput) => getPage(input, "pages"),
    refreshTopPages: (input: PageInput) => refreshPage(input, "pages"),
}
