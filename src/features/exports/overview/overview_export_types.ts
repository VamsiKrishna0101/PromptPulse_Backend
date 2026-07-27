import type { ExportFilters } from "../export_types"

export type OverviewMetric = {
    label: string
    value: number
    description: string
    format: "number" | "percent" | "position" | "score"
    previous: number | null
    delta: number | null
    lowerIsBetter?: boolean
}

export type OverviewTrendPoint = {
    date: string
    visibility: number
    responses: number
}

export type OverviewEngineRow = {
    engine: string
    responses: number
    visibility: number
    position: number | null
    sentiment: number | null
    sourceDomains: number
}

export type OverviewPromptRow = {
    promptId: string
    prompt: string
    topic: string
    responses: number
    visibility: number
    position: number | null
    sentiment: number | null
    status: "LEADER" | "OPPORTUNITY" | "GAP"
}

export type OverviewTopicRow = {
    topic: string
    prompts: number
    responses: number
    visibility: number
    position: number | null
}

export type OverviewBrandRow = {
    rank: number
    brand: string
    visibility: number
    mentions: number
    position: number | null
    sentiment: number | null
    isOwnBrand: boolean
}

export type OverviewSourceRow = {
    rank: number
    domain: string
    title: string
    usedPct: number
    sourceType: string
    citations: number
    url: string
    brandPresence: "CONFIRMED" | "NOT_CONFIRMED"
}

export type OverviewSourceTypeRow = {
    sourceType: string
    domains: number
    citations: number
    confirmedDomains: number
}

export type OverviewSentiment = {
    scoredResponses: number
    positive: number
    neutral: number
    negative: number
    average: number | null
}

export type OverviewOpportunityRow = {
    title: string
    prompt: string
    competitor: string
    impact: string
    effort: string
    score: number
    nextStep: string
}

export type OverviewActionRow = {
    priority: "HIGH" | "MEDIUM"
    horizon: "NOW" | "NEXT" | "LATER"
    title: string
    rationale: string
    action: string
    evidence: string
}

export type OverviewEvidenceRow = {
    date: Date
    engine: string
    prompt: string
    mentioned: boolean
    position: number | null
    sentiment: number | null
    source: string
}

export type OverviewCoverage = {
    activePrompts: number
    representedPrompts: number
    responses: number
    successfulRuns: number
    partialRuns: number
    failedRuns: number
    completedJobs: number
    failedJobs: number
    firstResponseAt: Date | null
    lastResponseAt: Date | null
}

export type OverviewExportModel = {
    brandName: string
    brandUrl: string
    generatedAt: Date
    filters: ExportFilters
    periodLabel: string
    comparisonLabel: string | null
    metrics: OverviewMetric[]
    trend: OverviewTrendPoint[]
    engines: OverviewEngineRow[]
    prompts: OverviewPromptRow[]
    topics: OverviewTopicRow[]
    brands: OverviewBrandRow[]
    sources: OverviewSourceRow[]
    sourceTypes: OverviewSourceTypeRow[]
    sentiment: OverviewSentiment
    opportunities: OverviewOpportunityRow[]
    actions: OverviewActionRow[]
    evidence: OverviewEvidenceRow[]
    coverage: OverviewCoverage
    executiveHeadline: string
    executivePoints: string[]
    methodology: string[]
}
