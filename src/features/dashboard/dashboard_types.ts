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
    }[]
    enqueue_source_enrichment?: boolean
    ingest_chat?: boolean
}

export type DashboardDataInput = {
    project_id: string
}
