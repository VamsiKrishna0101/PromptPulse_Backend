export type DataForSeoEnvironment = "sandbox" | "production"

export type DataForSeoTask<T> = {
    id?: string
    status_code?: number
    status_message?: string
    cost?: number
    path?: string[]
    result_count?: number
    result?: T[]
}

export type DataForSeoEnvelope<T> = {
    status_code?: number
    status_message?: string
    tasks?: DataForSeoTask<T>[]
}

export type DataForSeoCall<T> = {
    data: T
    costUsd: number
    taskIds: string[]
    environment: DataForSeoEnvironment
    paths: string[]
}

export type DataForSeoMetrics = {
    pos_1?: number | null
    pos_2_3?: number | null
    pos_4_10?: number | null
    pos_11_20?: number | null
    pos_21_30?: number | null
    pos_31_40?: number | null
    pos_41_50?: number | null
    pos_51_60?: number | null
    pos_61_70?: number | null
    pos_71_80?: number | null
    pos_81_90?: number | null
    pos_91_100?: number | null
    etv?: number | null
    count?: number | null
    estimated_paid_traffic_cost?: number | null
    is_new?: number | null
    is_up?: number | null
    is_down?: number | null
    is_lost?: number | null
}

export type DataForSeoMetricsContainer = {
    organic?: DataForSeoMetrics | null
    paid?: DataForSeoMetrics | null
}
