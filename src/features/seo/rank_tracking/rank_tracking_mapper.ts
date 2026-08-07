import type { RankDevice, RankSerpResult } from "./rank_tracking_types"

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
}

function rows(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.map(record) : []
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function normalizeHost(value: string | null): string | null {
    if (!value) return null
    try {
        return new URL(value.includes("://") ? value : `https://${value}`).hostname
            .toLowerCase()
            .replace(/^www\./, "")
    } catch {
        return value.toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "")
    }
}

function isTargetDomain(item: Record<string, unknown>, targetDomain: string) {
    const target = normalizeHost(targetDomain)
    const domain = normalizeHost(text(item.domain) ?? text(item.url))
    return Boolean(target && domain && (domain === target || domain.endsWith(`.${target}`)))
}

export function mapRankSerp(input: {
    result: unknown
    trackingKeywordId: string
    keyword: string
    device: RankDevice
    targetDomain: string
}): RankSerpResult {
    const root = record(input.result)
    const items = rows(root.items)
    const organic = items.filter(item => text(item.type)?.toLowerCase() === "organic")
    const match = organic.find(item => isTargetDomain(item, input.targetDomain))
    const position = match
        ? number(match.rank_group) ?? number(match.rank_absolute)
        : null

    return {
        trackingKeywordId: input.trackingKeywordId,
        keyword: input.keyword,
        device: input.device,
        position: position == null ? null : Math.max(1, Math.trunc(position)),
        rankingUrl: match ? text(match.url) : null,
        serpFeatures: [...new Set(
            items
                .map(item => text(item.type)?.toLowerCase())
                .filter((value): value is string => Boolean(value)),
        )],
    }
}
