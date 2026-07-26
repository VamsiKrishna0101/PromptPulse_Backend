export type RunPromptInput = {
    prompt_id: string
    run_id: string
    geo_variant_id?: string | null
    geo_country_code?: string | null
    geo_country_name?: string | null
    geo_city?: string | null
    raw_response: string
    ai_model: string
    screenshot_path?: string | null
    citations?: {
        text: string
        url: string
        domain?: string | null
        snippet?: string | null
        position?: number | null
        answer_position?: number | null
        is_cited?: boolean
        source_kind?: string | null
    }[]
    enqueue_source_enrichment?: boolean
    ingest_chat?: boolean
}

export type DashboardDataInput = {
    project_id: string
}
