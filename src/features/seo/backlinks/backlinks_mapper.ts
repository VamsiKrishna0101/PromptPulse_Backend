type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as JsonRecord
        : {}
}

function rows(value: unknown): JsonRecord[] {
    return Array.isArray(value) ? value.map(record) : []
}

function numberOrNull(value: unknown): number | null {
    if (value == null || value === "") return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function numericMap(value: unknown): Record<string, number> {
    const source = record(value)
    return Object.fromEntries(
        Object.entries(source)
            .map(([key, item]) => [key || "other", numberOrNull(item)] as const)
            .filter((entry): entry is readonly [string, number] => entry[1] !== null),
    )
}

export function mapBacklinksOverview(input: {
    target: string
    scope: "domain" | "page"
    summaryResult: JsonRecord | null
    historyResult: JsonRecord | null
    environment: "sandbox" | "production"
}) {
    const summary = input.summaryResult ?? {}
    const linkAttributes = numericMap(
        summary.referring_links_attributes ?? summary.referring_links_flags,
    )
    const backlinks = numberOrNull(summary.backlinks)
    const nofollowBacklinks = linkAttributes.nofollow ?? 0
    const history = rows(input.historyResult?.items)
        .map(item => ({
            date: text(item.date)?.slice(0, 10) ?? null,
            rank: numberOrNull(item.rank),
            backlinks: numberOrNull(item.backlinks),
            referringDomains: numberOrNull(item.referring_domains),
            newBacklinks: numberOrNull(item.new_backlinks),
            lostBacklinks: numberOrNull(item.lost_backlinks),
            newReferringDomains: numberOrNull(
                item.new_referring_domains ?? item.new_reffering_domains,
            ),
            lostReferringDomains: numberOrNull(
                item.lost_referring_domains ?? item.lost_reffering_domains,
            ),
        }))
        .filter(item => item.date)

    return {
        target: input.target,
        scope: input.scope,
        summary: {
            rank: numberOrNull(summary.rank),
            backlinks,
            dofollowBacklinks: backlinks === null ? null : Math.max(0, backlinks - nofollowBacklinks),
            nofollowBacklinks,
            referringPages: numberOrNull(summary.referring_pages),
            referringDomains: numberOrNull(summary.referring_domains),
            referringMainDomains: numberOrNull(summary.referring_main_domains),
            referringIps: numberOrNull(summary.referring_ips),
            brokenBacklinks: numberOrNull(summary.broken_backlinks),
            brokenPages: numberOrNull(summary.broken_pages),
            backlinksSpamScore: numberOrNull(summary.backlinks_spam_score),
            targetSpamScore: numberOrNull(record(summary.info).target_spam_score),
            newBacklinks: numberOrNull(summary.new_backlinks),
            lostBacklinks: numberOrNull(summary.lost_backlinks),
            newReferringDomains: numberOrNull(
                summary.new_referring_domains ?? summary.new_reffering_domains,
            ),
            lostReferringDomains: numberOrNull(
                summary.lost_referring_domains ?? summary.lost_reffering_domains,
            ),
            linkTypes: numericMap(summary.referring_links_types),
            linkAttributes,
            topLevelDomains: numericMap(summary.referring_links_tld),
            countries: numericMap(summary.referring_links_countries),
        },
        trends: history.map(item => ({
            date: item.date,
            backlinks: item.backlinks,
            referringDomains: item.referringDomains,
            rank: item.rank,
        })),
        newLostTrends: history.map(item => ({
            date: item.date,
            newBacklinks: item.newBacklinks,
            lostBacklinks: item.lostBacklinks,
            newReferringDomains: item.newReferringDomains,
            lostReferringDomains: item.lostReferringDomains,
        })),
        source: {
            provider: "dataforseo",
            environment: input.environment,
            estimated: true,
        },
    }
}

export function mapBacklinkRows(input: {
    result: JsonRecord | null
    page: number
    pageSize: number
    environment: "sandbox" | "production"
}) {
    const items = rows(input.result?.items).map(item => ({
        domainFrom: text(item.domain_from),
        urlFrom: text(item.url_from),
        urlTo: text(item.url_to),
        anchor: text(item.anchor),
        itemType: text(item.item_type),
        isDofollow: typeof item.dofollow === "boolean" ? item.dofollow : null,
        relAttributes: Array.isArray(item.rel_attributes)
            ? item.rel_attributes.filter(value => typeof value === "string")
            : Array.isArray(item.attributes)
                ? item.attributes.filter(value => typeof value === "string")
                : [],
        rank: numberOrNull(item.rank),
        domainFromRank: numberOrNull(item.domain_from_rank),
        pageFromRank: numberOrNull(item.page_from_rank),
        spamScore: numberOrNull(item.backlink_spam_score ?? item.backlinks_spam_score),
        firstSeen: text(item.first_seen),
        lastSeen: text(item.lost_date ?? item.last_seen ?? item.last_visited),
        isNew: item.is_new === true,
        isLost: item.is_lost === true || Boolean(item.lost_date),
        isBroken: item.is_broken === true,
        linksCount: numberOrNull(item.links_count),
    }))
    return paged(input, items)
}

export function mapReferringDomains(input: {
    result: JsonRecord | null
    page: number
    pageSize: number
    environment: "sandbox" | "production"
}) {
    const items = rows(input.result?.items).map(item => ({
        domain: text(item.domain),
        backlinks: numberOrNull(item.backlinks),
        referringPages: numberOrNull(item.referring_pages),
        rank: numberOrNull(item.rank),
        spamScore: numberOrNull(item.backlinks_spam_score),
        firstSeen: text(item.first_seen),
        brokenBacklinks: numberOrNull(item.broken_backlinks),
        brokenPages: numberOrNull(item.broken_pages),
    }))
    return paged(input, items)
}

export function mapBacklinkTopPages(input: {
    result: JsonRecord | null
    page: number
    pageSize: number
    environment: "sandbox" | "production"
}) {
    const items = rows(input.result?.items).map(item => ({
        page: text(item.page ?? item.url),
        backlinks: numberOrNull(item.backlinks),
        referringDomains: numberOrNull(item.referring_domains),
        rank: numberOrNull(item.rank),
        brokenBacklinks: numberOrNull(item.broken_backlinks),
    }))
    return paged(input, items)
}

export function mapBacklinkAnchors(input: {
    result: JsonRecord | null
    page: number
    pageSize: number
    environment: "sandbox" | "production"
}) {
    const items = rows(input.result?.items).map(item => ({
        anchor: text(item.anchor) ?? "No anchor text",
        rank: numberOrNull(item.rank),
        backlinks: numberOrNull(item.backlinks),
        referringDomains: numberOrNull(item.referring_domains),
        referringPages: numberOrNull(item.referring_pages),
        firstSeen: text(item.first_seen),
        lostDate: text(item.lost_date),
    }))
    return paged(input, items)
}

export function mapBacklinkCompetitors(input: {
    result: JsonRecord | null
    page: number
    pageSize: number
    environment: "sandbox" | "production"
}) {
    const items = rows(input.result?.items).map(item => ({
        domain: text(item.domain ?? item.target),
        rank: numberOrNull(item.rank),
        intersections: numberOrNull(item.intersections),
        backlinks: numberOrNull(item.backlinks),
        referringDomains: numberOrNull(item.referring_domains),
    }))
    return paged(input, items)
}

function paged(
    input: {
        result: JsonRecord | null
        page: number
        pageSize: number
        environment: "sandbox" | "production"
    },
    items: Record<string, unknown>[],
) {
    const totalCount = Number(input.result?.total_count ?? items.length)
    return {
        page: input.page,
        pageSize: input.pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / input.pageSize)),
        items,
        source: {
            provider: "dataforseo",
            environment: input.environment,
            estimated: true,
        },
    }
}
