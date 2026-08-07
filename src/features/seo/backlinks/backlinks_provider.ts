import { dataForSeoClient } from "../provider/dataforseo_client"
import type { ProviderResult } from "../domain_research/domain_research_types"
import {
    mapBacklinkAnchors,
    mapBacklinkCompetitors,
    mapBacklinkRows,
    mapBacklinksOverview,
    mapBacklinkTopPages,
    mapReferringDomains,
} from "./backlinks_mapper"

export type BacklinksReportMode = "normal" | "detailed"

function dateOnly(value: Date) {
    return value.toISOString().slice(0, 10)
}

function common(target: string, scope: "domain" | "page") {
    return {
        target,
        include_subdomains: scope === "domain",
        include_indirect_links: true,
        exclude_internal_backlinks: true,
        backlinks_status_type: "live",
        rank_scale: "one_hundred",
    }
}

export async function fetchBacklinksOverview(input: {
    target: string
    scope: "domain" | "page"
}): Promise<ProviderResult<Record<string, unknown>>> {
    const dateTo = new Date()
    dateTo.setUTCDate(dateTo.getUTCDate() - 1)
    const dateFrom = new Date(dateTo)
    dateFrom.setUTCFullYear(dateFrom.getUTCFullYear() - 1)
    const [summary, history] = await Promise.all([
        dataForSeoClient.backlinksSummary(common(input.target, input.scope)),
        dataForSeoClient.backlinksHistory({
            target: input.target,
            date_from: dateOnly(dateFrom),
            date_to: dateOnly(dateTo),
            rank_scale: "one_hundred",
        }),
    ])
    return {
        payload: mapBacklinksOverview({
            ...input,
            summaryResult: summary.data,
            historyResult: history.data,
            environment: summary.environment,
        }),
        costUsd: summary.costUsd + history.costUsd,
        taskIds: [...summary.taskIds, ...history.taskIds],
        environment: summary.environment,
    }
}

export async function fetchBacklinksReport(input: {
    target: string
    scope: "domain" | "page"
    reportMode: BacklinksReportMode
}): Promise<ProviderResult<Record<string, unknown>>> {
    const dateTo = new Date()
    dateTo.setUTCDate(dateTo.getUTCDate() - 1)
    const dateFrom = new Date(dateTo)
    dateFrom.setUTCFullYear(dateFrom.getUTCFullYear() - 1)
    const rowLimit = input.reportMode === "detailed" ? 200 : 100
    const payload = { ...common(input.target, input.scope), limit: rowLimit, offset: 0 }

    const summaryPromise = dataForSeoClient.backlinksSummary({
        ...common(input.target, input.scope),
        internal_list_limit: 20,
    })
    const historyPromise = dataForSeoClient.backlinksHistory({
        target: input.target,
        date_from: dateOnly(dateFrom),
        date_to: dateOnly(dateTo),
        rank_scale: "one_hundred",
    })
    const backlinksPromise = dataForSeoClient.backlinksRows({
        ...payload,
        mode: input.reportMode === "detailed" ? "as_is" : "one_per_domain",
        order_by: ["rank,desc"],
    })
    const domainsPromise = dataForSeoClient.referringDomains({
        ...payload,
        order_by: ["rank,desc", "backlinks,desc"],
    })
    const pagesPromise = dataForSeoClient.backlinkTopPages({
        ...payload,
        order_by: ["backlinks,desc"],
    })
    const anchorsPromise = input.reportMode === "detailed"
        ? dataForSeoClient.backlinkAnchors({
            ...payload,
            limit: 100,
            order_by: ["backlinks,desc"],
        })
        : Promise.resolve(null)
    const competitorsPromise = input.reportMode === "detailed"
        ? dataForSeoClient.backlinkCompetitors({
            target: input.target,
            limit: 100,
            order_by: ["intersections,desc", "rank,desc"],
            main_domain: input.scope === "domain",
            exclude_large_domains: true,
            exclude_internal_backlinks: true,
            rank_scale: "one_hundred",
        })
        : Promise.resolve(null)

    const [summary, history, backlinks, domains, pages, anchors, competitors] = await Promise.all([
        summaryPromise,
        historyPromise,
        backlinksPromise,
        domainsPromise,
        pagesPromise,
        anchorsPromise,
        competitorsPromise,
    ])
    const environment = summary.environment
    const overview = mapBacklinksOverview({
        ...input,
        summaryResult: summary.data,
        historyResult: history.data,
        environment,
    })
    const mappedBacklinks = mapBacklinkRows({ result: backlinks.data, page: 1, pageSize: rowLimit, environment })
    const mappedDomains = mapReferringDomains({ result: domains.data, page: 1, pageSize: rowLimit, environment })
    const mappedPages = mapBacklinkTopPages({ result: pages.data, page: 1, pageSize: rowLimit, environment })
    const mappedAnchors = anchors
        ? mapBacklinkAnchors({ result: anchors.data, page: 1, pageSize: 100, environment })
        : null
    const mappedCompetitors = competitors
        ? mapBacklinkCompetitors({ result: competitors.data, page: 1, pageSize: 100, environment })
        : null
    const calls = [summary, history, backlinks, domains, pages, anchors, competitors].filter(
        (call): call is NonNullable<typeof call> => call !== null,
    )

    return {
        payload: {
            ...overview,
            reportMode: input.reportMode,
            backlinks: mappedBacklinks,
            referringDomains: mappedDomains,
            topPages: mappedPages,
            anchors: mappedAnchors,
            competitors: mappedCompetitors,
        },
        costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
        taskIds: calls.flatMap(call => call.taskIds),
        environment,
    }
}

async function fetchPage(input: {
    kind: "backlinks" | "domains" | "pages"
    target: string
    scope: "domain" | "page"
    page: number
    pageSize: 50 | 100 | 200
    sortOrder: "asc" | "desc"
    mode: "one_per_domain" | "as_is"
}) {
    const payload = {
        ...common(input.target, input.scope),
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
    }
    const call =
        input.kind === "backlinks"
            ? await dataForSeoClient.backlinksRows({
                ...payload,
                order_by: [`first_seen,${input.sortOrder}`],
                mode: input.mode,
            })
            : input.kind === "domains"
                ? await dataForSeoClient.referringDomains({
                    ...payload,
                    order_by: [`backlinks,${input.sortOrder}`],
                })
                : await dataForSeoClient.backlinkTopPages({
                    ...payload,
                    order_by: [`backlinks,${input.sortOrder}`],
                })
    const mapperInput = {
        result: call.data,
        page: input.page,
        pageSize: input.pageSize,
        environment: call.environment,
    }
    const mapped =
        input.kind === "backlinks"
            ? mapBacklinkRows(mapperInput)
            : input.kind === "domains"
                ? mapReferringDomains(mapperInput)
                : mapBacklinkTopPages(mapperInput)
    return {
        payload: {
            target: input.target,
            scope: input.scope,
            kind: input.kind,
            ...mapped,
        },
        costUsd: call.costUsd,
        taskIds: call.taskIds,
        environment: call.environment,
    } satisfies ProviderResult<Record<string, unknown>>
}

export function fetchBacklinksPage(input: Omit<Parameters<typeof fetchPage>[0], "kind">) {
    return fetchPage({ ...input, kind: "backlinks" })
}

export function fetchReferringDomainsPage(input: Omit<Parameters<typeof fetchPage>[0], "kind">) {
    return fetchPage({ ...input, kind: "domains" })
}

export function fetchBacklinkTopPagesPage(input: Omit<Parameters<typeof fetchPage>[0], "kind">) {
    return fetchPage({ ...input, kind: "pages" })
}
