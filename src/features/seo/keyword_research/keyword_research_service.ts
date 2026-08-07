import { assertProjectAccess } from "../../projects/project_access"
import {
    persistProviderSnapshot,
    readProviderSnapshot,
    seoScopeKey,
    withProviderSnapshot,
} from "../shared/seo_snapshot_service"
import { seoSnapshotRepository } from "../shared/seo_snapshot_repository"
import { fetchKeywordResearch, type KeywordMatchType } from "./keyword_research_provider"

function normalizeQuery(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function scope(input: {
    query: string
    database: string
    matchType: KeywordMatchType
    pages: number
}) {
    const value = {
        query: normalizeQuery(input.query),
        database: input.database.trim().toLowerCase(),
        matchType: input.matchType,
        pages: input.pages,
    }
    return { value, key: seoScopeKey(value) }
}

type ResearchInput = {
    projectId: string
    userId: string
    query: string
    database: string
    matchType: KeywordMatchType
    pages: number
}

export async function getKeywordResearch(input: ResearchInput) {
    await assertProjectAccess(input.projectId, input.userId)
    const researchScope = scope(input)
    return readProviderSnapshot({
        projectId: input.projectId,
        feature: "KEYWORD_RESEARCH_APIFY",
        scopeKey: researchScope.key,
        label: "keyword research",
    })
}

export async function refreshKeywordResearch(input: ResearchInput) {
    await assertProjectAccess(input.projectId, input.userId)
    const researchScope = scope(input)
    const result = await fetchKeywordResearch(researchScope.value)
    return persistProviderSnapshot({
        projectId: input.projectId,
        userId: input.userId,
        feature: "KEYWORD_RESEARCH_APIFY",
        operation: "keyword_research",
        scopeKey: researchScope.key,
        result,
        ttlMs: 30 * 24 * 60 * 60 * 1000,
    })
}

export async function listKeywordResearchRuns(input: {
    projectId: string
    userId: string
    limit: number
}) {
    await assertProjectAccess(input.projectId, input.userId)
    const snapshots = await seoSnapshotRepository.findRecentByFeature({
        projectId: input.projectId,
        feature: "KEYWORD_RESEARCH_APIFY",
        limit: input.limit,
    })
    return snapshots.map(snapshot => withProviderSnapshot(
        snapshot.payload,
        snapshot,
        snapshot.expires_at.getTime() > Date.now() ? "HIT" : "STALE",
    ))
}
