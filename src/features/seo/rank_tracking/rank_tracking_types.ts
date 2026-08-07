export type RankDevice = "desktop" | "mobile"
export type RankDeviceMode = RankDevice | "both"
export type RankSchedule = "daily" | "weekly" | "monthly" | "manual"

export type RankSerpResult = {
    trackingKeywordId: string
    keyword: string
    device: RankDevice
    position: number | null
    rankingUrl: string | null
    serpFeatures: string[]
}

export type RankProviderResult = {
    data: RankSerpResult
    costUsd: number
    taskIds: string[]
    environment: "sandbox" | "production"
    paths: string[]
}
