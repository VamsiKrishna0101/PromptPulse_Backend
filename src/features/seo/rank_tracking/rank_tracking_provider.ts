import { dataForSeoClient } from "../provider/dataforseo_client"
import { mapRankSerp } from "./rank_tracking_mapper"
import type { RankDevice } from "./rank_tracking_types"

export async function postRankTasks(input: Array<{
    keyword: string
    locationCode: number
    locationName?: string | null
    languageCode: string
    device: RankDevice
    depth: number
    targetDomain: string
}>) {
    const taskIds: string[] = []
    let costUsd = 0
    const paths: string[] = []
    for (let offset = 0; offset < input.length; offset += 100) {
        const batch = input.slice(offset, offset + 100)
        const response = await dataForSeoClient.organicSerpStandard(batch.map(row => ({
            keyword: row.keyword,
            ...(row.locationName ? { location_name: row.locationName } : { location_code: row.locationCode }),
            language_code: row.languageCode,
            device: row.device,
            os: row.device === "desktop" ? "windows" : "android",
            depth: Math.min(100, Math.max(10, Math.ceil(row.depth / 10) * 10)),
            priority: 1,
            stop_crawl_on_match: [{ match_value: row.targetDomain, match_type: "with_subdomains" }],
            find_targets_in: ["organic"],
        })))
        taskIds.push(...response.taskIds)
        costUsd += response.costUsd
        paths.push(...response.paths)
    }
    return { data: null, costUsd, taskIds, environment: dataForSeoClient.environment(), paths }
}

export async function fetchRankTask(input: {
    taskId: string
    trackingKeywordId: string
    keyword: string
    device: RankDevice
    targetDomain: string
}) {
    const response = await dataForSeoClient.organicSerpTaskGet(input.taskId)
    return {
        ...response,
        data: mapRankSerp({
            result: response.data,
            trackingKeywordId: input.trackingKeywordId,
            keyword: input.keyword,
            device: input.device,
            targetDomain: input.targetDomain,
        }),
    }
}
