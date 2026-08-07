import type { SeoMarket } from "../shared/seo_market"

export type DomainResearchRange = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12
export type OrganicKeywordsLimit = 100 | 250 | 500 | 1000
export type TopPagesLimit = 25 | 50 | 100 | 250 | 500 | 1000
export type CompetitorsLimit = 25 | 50 | 100 | 250
export type KeywordGapLimit = 50 | 100 | 250

export type DomainResearchScope = {
    projectId: string
    userId: string
    domain: string
    market: SeoMarket
}

export type SnapshotMetadata = {
    id: string
    fetchedAt: string
    expiresAt: string
    cacheStatus: "HIT" | "STALE" | "REFRESHED"
}

export type ProviderMetadata = {
    provider: "dataforseo"
    environment: "sandbox" | "production"
    estimated: true
}

export type DomainResearchTarget = {
    domain: string
    locationCode: number
    locationName: string
    countryIsoCode: string
    languageCode: string
    languageName: string
}

export type ClickstreamDemographics = {
    female: number
    male: number
    age18to24: number
    age25to34: number
    age35to44: number
    age45to54: number
    age55to64: number
    age65Plus: number
} | null

export type SearchSummary = {
    traffic: number
    keywords: number
    trafficValueUsd: number
    clickstreamTraffic: number
    clickstreamDemographics: ClickstreamDemographics
}

export type RankingDistribution = {
    top3: number
    positions4To10: number
    positions11To20: number
    positions21To50: number
    positions51To100: number
}

export type SearchChanges = {
    new: number
    improved: number
    declined: number
    lost: number
}

export type DomainResearchOverviewPayload = {
    target: DomainResearchTarget
    summary: {
        organic: SearchSummary
        paid: SearchSummary
    }
    rankingDistribution: RankingDistribution
    changes: SearchChanges
    history: {
        date: string
        organic: SearchSummary
        paid: SearchSummary
        rankingDistribution: RankingDistribution
        changes: SearchChanges
    }[]
    availableHistoryMonths: number
    source: ProviderMetadata
}

export type OrganicKeywordsPayload = {
    target: DomainResearchTarget
    summary: {
        totalKeywords: number
        returnedKeywords: number
        top3: number
        top10: number
        top20: number
        estimatedTraffic: number
        estimatedTrafficValueUsd: number
        new: number
        improved: number
        declined: number
        lost: number
    }
    keywords: Record<string, unknown>[]
    source: ProviderMetadata & { databaseRefresh: "weekly" }
}

export type TopPagesPayload = {
    target: DomainResearchTarget
    summary: {
        totalPages: number
        returnedPages: number
        analyzedTraffic: number
        analyzedTrafficValueUsd: number
        pagesWithTop3Rankings: number
        growingPages: number
        decliningPages: number
    }
    pages: Record<string, unknown>[]
    source: ProviderMetadata & { databaseRefresh: "weekly" }
}

export type CompetitorsPayload = {
    target: DomainResearchTarget & { totalKeywords: number }
    summary: {
        totalCompetitors: number
        returnedCompetitors: number
        primaryCompetitors: number
        challengers: number
        sharedKeywordUniverse: number
        strongestCompetitor: string | null
    }
    competitors: Record<string, unknown>[]
    source: ProviderMetadata & {
        databaseRefresh: "weekly"
        maxRankGroup: 20
    }
}

export type KeywordGapPayload = {
    target: DomainResearchTarget & { competitorDomain: string }
    summary: {
        availableShared: number
        availableMissing: number
        returnedKeywords: number
        missing: number
        weak: number
        strong: number
        shared: number
        opportunitySearchVolume: number
    }
    keywords: Record<string, unknown>[]
    source: ProviderMetadata & {
        databaseRefresh: "weekly"
        comparisonRequests: 2
    }
}

export type ProviderResult<T> = {
    payload: T
    costUsd: number
    taskIds: string[]
    environment: "sandbox" | "production"
    provider?: "dataforseo" | "apify"
}
