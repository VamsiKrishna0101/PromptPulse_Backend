import { createHash } from "crypto"
import type { DomainResearchTarget } from "./domain_research_types"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as JsonRecord
        : {}
}

function rows(value: unknown): JsonRecord[] {
    return Array.isArray(value) ? value.map(record) : []
}

function number(value: unknown): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
    return typeof value === "string" ? value : ""
}

function idFor(value: string) {
    return createHash("sha1").update(value).digest("hex").slice(0, 16)
}

function statusFor(metrics: JsonRecord) {
    const improved = number(metrics.improvedKeywords)
    const declined = number(metrics.declinedKeywords)
    const top3 = number(metrics.top3Keywords)
    if (top3 > 0 && improved >= declined) return "WINNER"
    if (improved > declined * 1.2) return "GROWING"
    if (declined > improved * 1.2) return "DECLINING"
    if (number(metrics.rankingKeywords) === 0) return "OPPORTUNITY"
    return "STABLE"
}

function emptyMetrics() {
    return {
        pages: 0,
        rankingKeywords: 0,
        sampledKeywords: 0,
        top3Keywords: 0,
        top10Keywords: 0,
        estimatedTraffic: 0,
        trafficValueUsd: 0,
        searchDemand: 0,
        newKeywords: 0,
        improvedKeywords: 0,
        declinedKeywords: 0,
        lostKeywords: 0,
        trafficSharePercent: 0,
    }
}

function addMetrics(target: ReturnType<typeof emptyMetrics>, source: JsonRecord) {
    target.pages += 1
    target.rankingKeywords += number(source.rankingKeywords)
    target.top3Keywords += number(source.top3Keywords)
    target.top10Keywords += number(source.top10Keywords)
    target.estimatedTraffic += number(source.estimatedTraffic)
    target.trafficValueUsd += number(source.trafficValueUsd)
    target.newKeywords += number(source.newKeywords)
    target.improvedKeywords += number(source.improvedKeywords)
    target.declinedKeywords += number(source.declinedKeywords)
    target.lostKeywords += number(source.lostKeywords)
}

export function buildSiteStructure(input: {
    target: DomainResearchTarget
    keywordsPayload: JsonRecord | null
    keywordSnapshotId: string | null
    keywordLimit: number | null
    topPagesPayload: JsonRecord | null
    topPagesSnapshotId: string | null
    topPagesLimit: number | null
    fetchedAt: Date
}) {
    const topPages = rows(input.topPagesPayload?.pages)
    const keywordRows = rows(input.keywordsPayload?.keywords)
    const keywordByUrl = new Map<string, JsonRecord[]>()
    for (const keyword of keywordRows) {
        const url = text(keyword.url)
        if (!url) continue
        const existing = keywordByUrl.get(url) ?? []
        existing.push(keyword)
        keywordByUrl.set(url, existing)
    }

    const nodes = new Map<string, {
        id: string
        parentId: string | null
        type: "ROOT" | "SUBDOMAIN" | "FOLDER"
        label: string
        hostname: string
        path: string
        depth: number
        status: string
        metrics: ReturnType<typeof emptyMetrics>
        topKeywords: JsonRecord[]
    }>()
    const rootId = idFor(`root:${input.target.domain}`)
    nodes.set(rootId, {
        id: rootId,
        parentId: null,
        type: "ROOT",
        label: input.target.domain,
        hostname: input.target.domain,
        path: "/",
        depth: 0,
        status: "STABLE",
        metrics: emptyMetrics(),
        topKeywords: [],
    })

    const pages = topPages.map(page => {
        const url = text(page.url)
        let hostname = input.target.domain
        let path = text(page.path) || "/"
        try {
            const parsed = new URL(url)
            hostname = parsed.hostname.replace(/^www\./, "")
            path = `${parsed.pathname}${parsed.search}`
        } catch {
            // Retain provider path when the URL is unusual.
        }

        const nodeIds = [rootId]
        let parentId = rootId
        if (hostname !== input.target.domain) {
            const subdomainId = idFor(`subdomain:${hostname}`)
            if (!nodes.has(subdomainId)) {
                nodes.set(subdomainId, {
                    id: subdomainId,
                    parentId: rootId,
                    type: "SUBDOMAIN",
                    label: hostname,
                    hostname,
                    path: "/",
                    depth: 1,
                    status: "STABLE",
                    metrics: emptyMetrics(),
                    topKeywords: [],
                })
            }
            nodeIds.push(subdomainId)
            parentId = subdomainId
        }

        const firstFolder = path.split("/").filter(Boolean)[0]
        if (firstFolder) {
            const folderPath = `/${firstFolder}/`
            const folderId = idFor(`folder:${hostname}:${folderPath}`)
            if (!nodes.has(folderId)) {
                nodes.set(folderId, {
                    id: folderId,
                    parentId,
                    type: "FOLDER",
                    label: folderPath,
                    hostname,
                    path: folderPath,
                    depth: parentId === rootId ? 1 : 2,
                    status: "STABLE",
                    metrics: emptyMetrics(),
                    topKeywords: [],
                })
            }
            nodeIds.push(folderId)
        }

        for (const nodeId of nodeIds) {
            const node = nodes.get(nodeId)
            if (node) addMetrics(node.metrics, page)
        }

        const pageKeywords = (keywordByUrl.get(url) ?? [])
            .sort((a, b) => number(b.traffic) - number(a.traffic))
            .slice(0, 5)
            .map(keyword => ({
                keyword: text(keyword.keyword),
                position: keyword.position == null ? null : number(keyword.position),
                searchVolume: number(keyword.searchVolume),
                traffic: number(keyword.traffic),
                movement: text(keyword.movement) || "UNCHANGED",
            }))
        const primaryNodeId = nodeIds[nodeIds.length - 1]
        const pageMetrics = {
            rankingKeywords: number(page.rankingKeywords),
            sampledKeywords: pageKeywords.length,
            top3Keywords: number(page.top3Keywords),
            top10Keywords: number(page.top10Keywords),
            estimatedTraffic: number(page.estimatedTraffic),
            trafficValueUsd: number(page.trafficValueUsd),
            searchDemand: pageKeywords.reduce((sum, keyword) => sum + keyword.searchVolume, 0),
            newKeywords: number(page.newKeywords),
            improvedKeywords: number(page.improvedKeywords),
            declinedKeywords: number(page.declinedKeywords),
            lostKeywords: number(page.lostKeywords),
        }
        return {
            url,
            hostname,
            path,
            primaryNodeId,
            nodeIds,
            source: keywordByUrl.has(url) ? "BOTH" : "TOP_PAGES",
            status: statusFor(pageMetrics),
            metrics: pageMetrics,
            keywords: pageKeywords,
        }
    })

    const rootTraffic = nodes.get(rootId)?.metrics.estimatedTraffic ?? 0
    const normalizedNodes = [...nodes.values()].map(node => {
        node.metrics.sampledKeywords = pages
            .filter(page => page.nodeIds.includes(node.id))
            .reduce((sum, page) => sum + page.keywords.length, 0)
        node.metrics.searchDemand = pages
            .filter(page => page.nodeIds.includes(node.id))
            .reduce((sum, page) => sum + page.metrics.searchDemand, 0)
        node.metrics.trafficValueUsd = Number(node.metrics.trafficValueUsd.toFixed(2))
        node.metrics.trafficSharePercent = rootTraffic > 0
            ? Number(((node.metrics.estimatedTraffic / rootTraffic) * 100).toFixed(1))
            : 0
        node.status = statusFor(node.metrics)
        node.topKeywords = pages
            .filter(page => page.nodeIds.includes(node.id))
            .flatMap(page => page.keywords)
            .sort((a, b) => number(b.traffic) - number(a.traffic))
            .slice(0, 5)
        return node
    })
    const rankedSections = normalizedNodes
        .filter(node => node.type !== "ROOT")
        .sort((a, b) => b.metrics.estimatedTraffic - a.metrics.estimatedTraffic)

    return {
        target: input.target,
        summary: {
            activeSubdomains: normalizedNodes.filter(node => node.type === "SUBDOMAIN").length,
            rankingFolders: normalizedNodes.filter(node => node.type === "FOLDER").length,
            rankingPages: pages.length,
            rankingKeywords: number(input.keywordsPayload?.summary && record(input.keywordsPayload.summary).totalKeywords),
            estimatedTraffic: rootTraffic,
            trafficValueUsd: Number((nodes.get(rootId)?.metrics.trafficValueUsd ?? 0).toFixed(2)),
            strongestSection: rankedSections[0]?.label ?? null,
            decliningSections: rankedSections.filter(node => node.status === "DECLINING").length,
        },
        nodes: normalizedNodes,
        pages,
        coverage: {
            organicKeywordsAvailable: Boolean(input.keywordsPayload),
            topPagesAvailable: Boolean(input.topPagesPayload),
            organicKeywordLimit: input.keywordLimit,
            topPagesLimit: input.topPagesLimit,
            organicKeywordRows: keywordRows.length,
            topPageRows: topPages.length,
            label:
                input.keywordsPayload && input.topPagesPayload
                    ? "Built from the latest organic-keyword and top-page snapshots."
                    : "Refresh organic keywords and top pages for complete site structure coverage.",
        },
        source: {
            derived: true,
            providerRequests: 0,
            organicKeywordsSnapshotId: input.keywordSnapshotId,
            topPagesSnapshotId: input.topPagesSnapshotId,
            fetchedAt: input.fetchedAt.toISOString(),
            databaseRefresh: "weekly",
        },
    }
}
