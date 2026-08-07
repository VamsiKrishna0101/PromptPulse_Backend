import { createHash } from "crypto"
import {
    chargeSeoProviderCost,
    refundSeoProviderCharge,
} from "./seo_credits"
import { SeoError } from "./seo_errors"
import { seoSnapshotRepository } from "./seo_snapshot_repository"
import type { ProviderResult } from "../domain_research/domain_research_types"

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
}

export function seoScopeKey(value: unknown): string {
    const serialized = JSON.stringify(value, Object.keys(record(value)).sort())
    return createHash("sha256").update(serialized).digest("hex")
}

export function withProviderSnapshot(
    payload: unknown,
    snapshot: {
        id: string
        fetched_at: Date
        expires_at: Date
    },
    cacheStatus: "HIT" | "STALE" | "REFRESHED",
) {
    return {
        ...record(payload),
        snapshot: {
            id: snapshot.id,
            fetchedAt: snapshot.fetched_at.toISOString(),
            expiresAt: snapshot.expires_at.toISOString(),
            cacheStatus,
        },
    }
}

export async function readProviderSnapshot(input: {
    projectId: string
    feature: string
    scopeKey: string
    label: string
}) {
    const snapshot = await seoSnapshotRepository.findLatest(input)
    if (!snapshot) {
        throw new SeoError(
            "SEO_SNAPSHOT_NOT_FOUND",
            `No ${input.label} snapshot exists yet. Run a refresh first.`,
            404,
        )
    }
    return withProviderSnapshot(
        snapshot.payload,
        snapshot,
        snapshot.expires_at.getTime() > Date.now() ? "HIT" : "STALE",
    )
}

export async function persistProviderSnapshot<T>(input: {
    projectId: string
    userId: string
    feature: string
    operation: string
    scopeKey: string
    result: ProviderResult<T>
    ttlMs?: number
}) {
    const charged = await chargeSeoProviderCost({
        userId: input.userId,
        projectId: input.projectId,
        operation: input.operation,
        costUsd: input.result.costUsd,
        environment: input.result.environment,
        taskIds: input.result.taskIds,
        provider: input.result.provider,
    })
    try {
        const snapshot = await seoSnapshotRepository.create({
            projectId: input.projectId,
            userId: input.userId,
            feature: input.feature,
            scopeKey: input.scopeKey,
            payload: input.result.payload,
            providerEnvironment: input.result.environment,
            providerCostUsd: input.result.costUsd,
            providerTaskIds: input.result.taskIds,
            expiresAt: new Date(Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS)),
        })
        return withProviderSnapshot(input.result.payload, snapshot, "REFRESHED")
    } catch (error) {
        await refundSeoProviderCharge({
            userId: input.userId,
            projectId: input.projectId,
            operation: input.operation,
            credits: charged.credits,
            idempotencyKey: charged.idempotencyKey,
        })
        throw error
    }
}
