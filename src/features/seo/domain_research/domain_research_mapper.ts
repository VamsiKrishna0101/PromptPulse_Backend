import { relativeUrl, safeUrlPath } from "../shared/seo_domain"
import type { DataForSeoMetrics, DataForSeoMetricsContainer } from "../provider/dataforseo_types"
import type {
    CompetitorsPayload,
    DomainResearchOverviewPayload,
    DomainResearchTarget,
    KeywordGapPayload,
    OrganicKeywordsPayload,
    ProviderMetadata,
    RankingDistribution,
    SearchChanges,
    SearchSummary,
    TopPagesPayload,
} from "./domain_research_types"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as JsonRecord
        : {}
}

function records(value: unknown): JsonRecord[] {
    return Array.isArray(value) ? value.map(record) : []
}

function number(value: unknown): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function nullableNumber(value: unknown): number | null {
    if (value == null || value === "") return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function metrics(value: unknown): DataForSeoMetrics {
    return record(value) as DataForSeoMetrics
}

function metricsContainer(value: unknown): DataForSeoMetricsContainer {
    return record(value) as DataForSeoMetricsContainer
}

function resultItems(result: JsonRecord | null): JsonRecord[] {
    return result ? records(result.items) : []
}

function clickstreamDemographics(value: DataForSeoMetrics | null | undefined) {
    if (!value || !value.clickstream_gender_distribution) return null
    const gender = record(value.clickstream_gender_distribution)
    const age = record(value.clickstream_age_distribution)
    
    // Only return if we actually have some data
    if (!number(gender.female) && !number(gender.male)) return null
    
    return {
        female: Math.round(number(gender.female)),
        male: Math.round(number(gender.male)),
        age18to24: Math.round(number(age["18-24"])),
        age25to34: Math.round(number(age["25-34"])),
        age35to44: Math.round(number(age["35-44"])),
        age45to54: Math.round(number(age["45-54"])),
        age55to64: Math.round(number(age["55-64"])),
        age65Plus: Math.round(number(age["65+"])),
    }
}

function searchSummary(value: DataForSeoMetrics | null | undefined): SearchSummary {
    return {
        traffic: Math.round(number(value?.etv)),
        keywords: Math.round(number(value?.count)),
        trafficValueUsd: Number(number(value?.estimated_paid_traffic_cost).toFixed(2)),
        clickstreamTraffic: Math.round(number(value?.clickstream_etv)),
        clickstreamDemographics: clickstreamDemographics(value),
    }
}

function rankingDistribution(value: DataForSeoMetrics | null | undefined): RankingDistribution {
    return {
        top3: Math.round(number(value?.pos_1) + number(value?.pos_2_3)),
        positions4To10: Math.round(number(value?.pos_4_10)),
        positions11To20: Math.round(number(value?.pos_11_20)),
        positions21To50: Math.round(
            number(value?.pos_21_30) +
            number(value?.pos_31_40) +
            number(value?.pos_41_50),
        ),
        positions51To100: Math.round(
            number(value?.pos_51_60) +
            number(value?.pos_61_70) +
            number(value?.pos_71_80) +
            number(value?.pos_81_90) +
            number(value?.pos_91_100),
        ),
    }
}

function changes(value: DataForSeoMetrics | null | undefined): SearchChanges {
    return {
        new: Math.round(number(value?.is_new)),
        improved: Math.round(number(value?.is_up)),
        declined: Math.round(number(value?.is_down)),
        lost: Math.round(number(value?.is_lost)),
    }
}

function source(
    environment: "sandbox" | "production",
): ProviderMetadata {
    return {
        provider: "dataforseo",
        environment,
        estimated: true,
    }
}

function keywordIntent(keywordData: JsonRecord): string | null {
    const intent = record(keywordData.search_intent_info)
    return text(intent.main_intent)?.toLowerCase() ?? null
}

function keywordInfo(keywordData: JsonRecord) {
    return record(keywordData.keyword_info)
}

function keywordProperties(keywordData: JsonRecord) {
    return record(keywordData.keyword_properties)
}

function rankedSerpItem(item: JsonRecord) {
    const ranked = record(item.ranked_serp_element)
    const serp = record(ranked.serp_item)
    return Object.keys(serp).length ? serp : ranked
}

function keywordMovement(serp: JsonRecord) {
    const rankChanges = record(serp.rank_changes)
    if (rankChanges.is_new === true) return "NEW"
    if (rankChanges.is_up === true) return "UP"
    if (rankChanges.is_down === true) return "DOWN"
    return "UNCHANGED"
}

function mapOrganicKeyword(item: JsonRecord) {
    const keywordData = record(item.keyword_data)
    const info = keywordInfo(keywordData)
    const properties = keywordProperties(keywordData)
    const serpInfo = record(keywordData.serp_info)
    const serp = rankedSerpItem(item)
    const rankChanges = record(serp.rank_changes)
    const position = nullableNumber(serp.rank_group ?? serp.rank_absolute)
    const absolutePosition = nullableNumber(serp.rank_absolute)
    const previousPosition = nullableNumber(rankChanges.previous_rank_absolute)
    const movement = keywordMovement(serp)
    const features = Array.isArray(serpInfo.serp_item_types)
        ? serpInfo.serp_item_types.filter((value): value is string => typeof value === "string")
        : []
    const url = text(serp.url)

    return {
        keyword: text(keywordData.keyword ?? item.keyword) ?? "",
        position,
        absolutePosition,
        previousPosition,
        movement,
        positionChange:
            position != null && previousPosition != null
                ? previousPosition - position
                : null,
        searchVolume: Math.round(number(info.search_volume)),
        cpcUsd: Number(number(info.cpc).toFixed(2)),
        competition: nullableNumber(info.competition),
        competitionLevel: text(info.competition_level)?.toUpperCase() ?? null,
        difficulty: nullableNumber(
            properties.keyword_difficulty ?? info.keyword_difficulty,
        ),
        intent: keywordIntent(keywordData),
        url,
        relativeUrl: relativeUrl(text(serp.relative_url) ?? url),
        title: text(serp.title),
        traffic: Math.round(number(serp.etv)),
        trafficValueUsd: Number(number(serp.estimated_paid_traffic_cost).toFixed(2)),
        serpFeatures: features,
        isFeaturedSnippet:
            serp.is_featured_snippet === true ||
            serp.type === "featured_snippet" ||
            features.includes("featured_snippet"),
    }
}

export function mapOverview(input: {
    target: DomainResearchTarget
    current: JsonRecord | null
    historical: JsonRecord | null
    environment: "sandbox" | "production"
}): DomainResearchOverviewPayload {
    const currentItem = resultItems(input.current)[0] ?? {}
    const currentMetrics = metricsContainer(currentItem.metrics)
    const organic = metrics(currentMetrics.organic)
    const paid = metrics(currentMetrics.paid)
    const history = resultItems(input.historical)
        .map(item => {
            const itemMetrics = metricsContainer(item.metrics)
            const itemOrganic = metrics(itemMetrics.organic)
            const itemPaid = metrics(itemMetrics.paid)
            const year = Math.round(number(item.year))
            const month = Math.round(number(item.month))
            if (!year || month < 1 || month > 12) return null
            return {
                date: `${year}-${String(month).padStart(2, "0")}-01`,
                organic: searchSummary(itemOrganic),
                paid: searchSummary(itemPaid),
                rankingDistribution: rankingDistribution(itemOrganic),
                changes: changes(itemOrganic),
            }
        })
        .filter((item): item is NonNullable<typeof item> => item != null)
        .sort((a, b) => a.date.localeCompare(b.date))

    return {
        target: input.target,
        summary: {
            organic: searchSummary(organic),
            paid: searchSummary(paid),
        },
        rankingDistribution: rankingDistribution(organic),
        changes: changes(organic),
        history,
        availableHistoryMonths: history.length,
        source: source(input.environment),
    }
}

export function mapOrganicKeywords(input: {
    target: DomainResearchTarget
    result: JsonRecord | null
    environment: "sandbox" | "production"
}): OrganicKeywordsPayload {
    const keywords = resultItems(input.result)
        .map(mapOrganicKeyword)
        .filter(item => item.keyword)
    const totalKeywords = Math.round(number(input.result?.total_count))

    return {
        target: input.target,
        summary: {
            totalKeywords,
            returnedKeywords: keywords.length,
            top3: keywords.filter(item => item.position != null && item.position <= 3).length,
            top10: keywords.filter(item => item.position != null && item.position <= 10).length,
            top20: keywords.filter(item => item.position != null && item.position <= 20).length,
            estimatedTraffic: keywords.reduce((sum, item) => sum + item.traffic, 0),
            estimatedTrafficValueUsd: Number(
                keywords.reduce((sum, item) => sum + item.trafficValueUsd, 0).toFixed(2),
            ),
            new: keywords.filter(item => item.movement === "NEW").length,
            improved: keywords.filter(item => item.movement === "UP").length,
            declined: keywords.filter(item => item.movement === "DOWN").length,
            lost: keywords.filter(item => item.movement === "LOST").length,
        },
        keywords,
        source: {
            ...source(input.environment),
            databaseRefresh: "weekly",
        },
    }
}

function pageStatus(organic: DataForSeoMetrics) {
    const up = number(organic.is_up)
    const down = number(organic.is_down)
    const top3 = number(organic.pos_1) + number(organic.pos_2_3)
    if (top3 > 0 && up >= down) return "WINNER"
    if (up > down * 1.2) return "GROWING"
    if (down > up * 1.2) return "DECLINING"
    return "OPPORTUNITY"
}

export function mapTopPages(input: {
    target: DomainResearchTarget
    result: JsonRecord | null
    environment: "sandbox" | "production"
}): TopPagesPayload {
    const pages = resultItems(input.result)
        .map(item => {
            const url = text(item.page_address)
            if (!url) return null
            const container = metricsContainer(item.metrics)
            const organic = metrics(container.organic)
            return {
                url,
                path: safeUrlPath(url),
                estimatedTraffic: Math.round(number(organic.etv)),
                trafficValueUsd: Number(number(organic.estimated_paid_traffic_cost).toFixed(2)),
                rankingKeywords: Math.round(number(organic.count)),
                top1Keywords: Math.round(number(organic.pos_1)),
                top3Keywords: Math.round(number(organic.pos_1) + number(organic.pos_2_3)),
                top10Keywords: Math.round(
                    number(organic.pos_1) +
                    number(organic.pos_2_3) +
                    number(organic.pos_4_10),
                ),
                top20Keywords: Math.round(
                    number(organic.pos_1) +
                    number(organic.pos_2_3) +
                    number(organic.pos_4_10) +
                    number(organic.pos_11_20),
                ),
                top50Keywords: Math.round(
                    number(organic.pos_1) +
                    number(organic.pos_2_3) +
                    number(organic.pos_4_10) +
                    number(organic.pos_11_20) +
                    number(organic.pos_21_30) +
                    number(organic.pos_31_40) +
                    number(organic.pos_41_50),
                ),
                top100Keywords: Math.round(number(organic.count)),
                newKeywords: Math.round(number(organic.is_new)),
                improvedKeywords: Math.round(number(organic.is_up)),
                declinedKeywords: Math.round(number(organic.is_down)),
                lostKeywords: Math.round(number(organic.is_lost)),
                status: pageStatus(organic),
                clickstreamTraffic: Math.round(number(organic.clickstream_etv)),
                clickstreamDemographics: clickstreamDemographics(organic),
            }
        })
        .filter((item): item is NonNullable<typeof item> => item != null)

    return {
        target: input.target,
        summary: {
            totalPages: Math.round(number(input.result?.total_count)),
            returnedPages: pages.length,
            analyzedTraffic: pages.reduce((sum, page) => sum + page.estimatedTraffic, 0),
            analyzedTrafficValueUsd: Number(
                pages.reduce((sum, page) => sum + page.trafficValueUsd, 0).toFixed(2),
            ),
            pagesWithTop3Rankings: pages.filter(page => page.top3Keywords > 0).length,
            growingPages: pages.filter(page => page.status === "GROWING" || page.status === "WINNER").length,
            decliningPages: pages.filter(page => page.status === "DECLINING").length,
        },
        pages,
        source: {
            ...source(input.environment),
            databaseRefresh: "weekly",
        },
    }
}

function competitorStrength(sharedCoverage: number, trafficGap: number) {
    if (sharedCoverage >= 20 || trafficGap > 0) return "PRIMARY"
    if (sharedCoverage >= 8) return "CHALLENGER"
    return "EMERGING"
}

export function mapCompetitors(input: {
    target: DomainResearchTarget
    targetKeywordCount: number
    result: JsonRecord | null
    environment: "sandbox" | "production"
}): CompetitorsPayload {
    const competitors = resultItems(input.result)
        .map(item => {
            const domain = text(item.domain)
            if (!domain) return null
            const full = metrics(metricsContainer(item.full_domain_metrics).organic)
            const sharedTarget = metrics(metricsContainer(item.metrics).organic)
            const sharedCompetitor = metrics(metricsContainer(item.competitor_metrics).organic)
            const sharedKeywords = Math.round(number(item.intersections ?? sharedTarget.count))
            const sharedCoveragePercent = input.targetKeywordCount > 0
                ? Number(((sharedKeywords / input.targetKeywordCount) * 100).toFixed(1))
                : 0
            const targetSharedTraffic = Math.round(number(sharedTarget.etv))
            const competitorSharedTraffic = Math.round(number(sharedCompetitor.etv))
            const sharedTrafficGap = competitorSharedTraffic - targetSharedTraffic
            return {
                domain,
                averagePosition: Number(number(item.avg_position).toFixed(1)),
                sharedKeywords,
                sharedCoveragePercent,
                totalKeywords: Math.round(number(full.count)),
                estimatedTraffic: Math.round(number(full.etv)),
                trafficValueUsd: Number(number(full.estimated_paid_traffic_cost).toFixed(2)),
                top3Keywords: Math.round(number(full.pos_1) + number(full.pos_2_3)),
                top10Keywords: Math.round(
                    number(full.pos_1) + number(full.pos_2_3) + number(full.pos_4_10),
                ),
                targetSharedTraffic,
                competitorSharedTraffic,
                sharedTrafficGap,
                newKeywords: Math.round(number(full.is_new)),
                improvedKeywords: Math.round(number(full.is_up)),
                declinedKeywords: Math.round(number(full.is_down)),
                lostKeywords: Math.round(number(full.is_lost)),
                strength: competitorStrength(sharedCoveragePercent, sharedTrafficGap),
                clickstreamTraffic: Math.round(number(full.clickstream_etv)),
                clickstreamDemographics: clickstreamDemographics(full),
            }
        })
        .filter((item): item is NonNullable<typeof item> => item != null)
    const strongest = [...competitors].sort(
        (a, b) => b.sharedKeywords - a.sharedKeywords || b.estimatedTraffic - a.estimatedTraffic,
    )[0]

    return {
        target: {
            ...input.target,
            totalKeywords: input.targetKeywordCount,
        },
        summary: {
            totalCompetitors: Math.round(number(input.result?.total_count)),
            returnedCompetitors: competitors.length,
            primaryCompetitors: competitors.filter(item => item.strength === "PRIMARY").length,
            challengers: competitors.filter(item => item.strength === "CHALLENGER").length,
            sharedKeywordUniverse: competitors.reduce((sum, item) => sum + item.sharedKeywords, 0),
            strongestCompetitor: strongest?.domain ?? null,
        },
        competitors,
        source: {
            ...source(input.environment),
            databaseRefresh: "weekly",
            maxRankGroup: 20,
        },
    }
}

function mapGapItem(
    item: JsonRecord,
    categoryHint: "MISSING" | "SHARED",
) {
    const keywordData = record(item.keyword_data)
    const info = keywordInfo(keywordData)
    const properties = keywordProperties(keywordData)
    const client = record(item.second_domain_serp_element)
    const competitor = record(item.first_domain_serp_element)
    const clientPosition = nullableNumber(client.rank_group ?? client.rank_absolute)
    const competitorPosition = nullableNumber(competitor.rank_group ?? competitor.rank_absolute)
    let category: "MISSING" | "WEAK" | "STRONG" | "SHARED" = categoryHint
    if (categoryHint === "SHARED" && clientPosition != null && competitorPosition != null) {
        if (clientPosition - competitorPosition >= 4) category = "WEAK"
        else if (competitorPosition - clientPosition >= 4) category = "STRONG"
    }
    const searchVolume = Math.round(number(info.search_volume))
    const difficulty = nullableNumber(properties.keyword_difficulty)
    const positionGap =
        clientPosition != null && competitorPosition != null
            ? clientPosition - competitorPosition
            : null
    const clientTraffic = Math.round(number(client.etv))
    const competitorTraffic = Math.round(number(competitor.etv))
    const priorityScore = Math.min(
        100,
        Math.round(
            Math.log10(Math.max(10, searchVolume)) * 15 +
            (category === "MISSING" ? 30 : category === "WEAK" ? 20 : 5) +
            Math.max(0, 20 - (difficulty ?? 50) / 5),
        ),
    )

    return {
        keyword: text(keywordData.keyword) ?? "",
        category,
        searchVolume,
        cpcUsd: Number(number(info.cpc).toFixed(2)),
        difficulty,
        intent: keywordIntent(keywordData),
        clientPosition,
        competitorPosition,
        positionGap,
        clientUrl: text(client.url),
        competitorUrl: text(competitor.url),
        clientTraffic,
        competitorTraffic,
        priorityScore,
    }
}

export function mapKeywordGap(input: {
    target: DomainResearchTarget
    competitorDomain: string
    sharedResult: JsonRecord | null
    missingResult: JsonRecord | null
    environment: "sandbox" | "production"
}): KeywordGapPayload {
    const shared = resultItems(input.sharedResult)
        .map(item => mapGapItem(item, "SHARED"))
        .filter(item => item.keyword)
    const missing = resultItems(input.missingResult)
        .map(item => mapGapItem(item, "MISSING"))
        .filter(item => item.keyword)
    const keywords = [...missing, ...shared]
        .sort((a, b) => b.priorityScore - a.priorityScore || b.searchVolume - a.searchVolume)

    return {
        target: {
            ...input.target,
            competitorDomain: input.competitorDomain,
        },
        summary: {
            availableShared: Math.round(number(input.sharedResult?.total_count)),
            availableMissing: Math.round(number(input.missingResult?.total_count)),
            returnedKeywords: keywords.length,
            missing: keywords.filter(item => item.category === "MISSING").length,
            weak: keywords.filter(item => item.category === "WEAK").length,
            strong: keywords.filter(item => item.category === "STRONG").length,
            shared: keywords.filter(item => item.category === "SHARED").length,
            opportunitySearchVolume: keywords
                .filter(item => item.category === "MISSING" || item.category === "WEAK")
                .reduce((sum, item) => sum + item.searchVolume, 0),
        },
        keywords,
        source: {
            ...source(input.environment),
            databaseRefresh: "weekly",
            comparisonRequests: 2,
        },
    }
}
