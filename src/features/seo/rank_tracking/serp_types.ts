export type BrightDataSerpOrganicResult = {
    rank: number | null
    url: string
    title: string | null
    description: string | null
}

export type BrightDataSerpRecord = {
    keyword?: string
    organic: BrightDataSerpOrganicResult[]
    related_queries: string[]
}

export type SeoRankResultInput = {
    keyword: string
    targetUrl: string
    targetDomain: string
    country: string
    language: string
}
