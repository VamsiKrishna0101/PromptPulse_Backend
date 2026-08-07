import { dataForSeoClient } from "../provider/dataforseo_client"
import { mapCompetitors, mapKeywordGap, mapOrganicKeywords, mapOverview, mapTopPages } from "./domain_research_mapper"
import type {
    CompetitorsLimit,
    DomainResearchRange,
    DomainResearchScope,
    KeywordGapLimit,
    OrganicKeywordsLimit,
    ProviderResult,
    TopPagesLimit,
} from "./domain_research_types"

function target(scope: DomainResearchScope) {
    return {
        domain: scope.domain,
        locationCode: scope.market.locationCode,
        locationName: scope.market.locationName,
        countryIsoCode: scope.market.countryIsoCode,
        languageCode: scope.market.languageCode,
        languageName: scope.market.languageName,
    }
}

function providerPayload(scope: DomainResearchScope) {
    return {
        target: scope.domain,
        location_code: scope.market.locationCode,
        language_code: scope.market.languageCode,
    }
}

function dateOnly(date: Date): string {
    return date.toISOString().slice(0, 10)
}

function combine<T>(
    payload: T,
    calls: {
        costUsd: number
        taskIds: string[]
        environment: "sandbox" | "production"
    }[],
): ProviderResult<T> {
    const environment = calls[0]?.environment ?? dataForSeoClient.environment()
    return {
        payload,
        costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
        taskIds: calls.flatMap(call => call.taskIds),
        environment,
    }
}

export async function fetchOverview(
    scope: DomainResearchScope,
    range: DomainResearchRange,
) {
    const dateTo = new Date()
    const dateFrom = new Date(Date.UTC(
        dateTo.getUTCFullYear(),
        dateTo.getUTCMonth() - range + 1,
        1,
    ))
    const base = providerPayload(scope)
    const [current, historical] = await Promise.all([
        dataForSeoClient.domainRankOverview({
            ...base,
            limit: 1,
        }),
        dataForSeoClient.historicalRankOverview({
            ...base,
            date_from: dateOnly(dateFrom),
            date_to: dateOnly(dateTo),
        }),
    ])

    return combine(
        mapOverview({
            target: target(scope),
            current: current.data,
            historical: historical.data,
            environment: current.environment,
        }),
        [current, historical],
    )
}

export async function fetchOrganicKeywords(
    scope: DomainResearchScope,
    limit: OrganicKeywordsLimit,
) {
    const result = await dataForSeoClient.rankedKeywords({
        ...providerPayload(scope),
        limit,
        order_by: ["ranked_serp_element.serp_item.etv,desc"],
        include_subdomains: true,
    })
    return combine(
        mapOrganicKeywords({
            target: target(scope),
            result: result.data,
            environment: result.environment,
        }),
        [result],
    )
}

export async function fetchTopPages(
    scope: DomainResearchScope,
    limit: TopPagesLimit,
) {
    const result = await dataForSeoClient.relevantPages({
        ...providerPayload(scope),
        limit,
        order_by: ["metrics.organic.etv,desc"],
    })
    return combine(
        mapTopPages({
            target: target(scope),
            result: result.data,
            environment: result.environment,
        }),
        [result],
    )
}

export async function fetchCompetitors(
    scope: DomainResearchScope,
    limit: CompetitorsLimit,
    targetKeywordCount: number,
) {
    const result = await dataForSeoClient.competitorsDomain({
        ...providerPayload(scope),
        limit,
        exclude_top_domains: false,
        max_rank_group: 20,
        order_by: ["intersections,desc"],
    })
    return combine(
        mapCompetitors({
            target: target(scope),
            targetKeywordCount,
            result: result.data,
            environment: result.environment,
        }),
        [result],
    )
}

export async function fetchKeywordGap(
    scope: DomainResearchScope,
    competitorDomain: string,
    limit: KeywordGapLimit,
) {
    const sharedLimit = Math.max(1, Math.floor(limit / 2))
    const missingLimit = Math.max(1, limit - sharedLimit)
    const common = {
        location_code: scope.market.locationCode,
        language_code: scope.market.languageCode,
        include_serp_info: true,
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
    }
    const [shared, missing] = await Promise.all([
        dataForSeoClient.domainIntersection({
            ...common,
            target1: competitorDomain,
            target2: scope.domain,
            intersections: true,
            limit: sharedLimit,
        }),
        dataForSeoClient.domainIntersection({
            ...common,
            target1: competitorDomain,
            target2: scope.domain,
            intersections: false,
            limit: missingLimit,
        }),
    ])

    return combine(
        mapKeywordGap({
            target: target(scope),
            competitorDomain,
            sharedResult: shared.data,
            missingResult: missing.data,
            environment: shared.environment,
        }),
        [shared, missing],
    )
}
