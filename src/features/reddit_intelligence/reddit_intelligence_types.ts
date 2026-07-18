export type RedditScanMode = "standard" | "deep"

export type AgentsRedditPost = {
    post_id?: string | null
    url: string
    subreddit?: string | null
    title: string
    description?: string | null
    author?: string | null
    keyword?: string | null
    num_comments?: number
    num_upvotes?: number
    date_posted?: string | null
    sentiment?: string | null
    intent?: string | null
    importance_score?: number
    relevance_score?: number
    relevance_bucket?: "relevant" | "maybe" | "rejected"
    relevance_reasons?: string[]
    mentioned_brands?: string[]
    mentioned_competitors?: string[]
    raw_json?: Record<string, unknown>
}

export type AgentsRedditScanResponse = {
    run_id: string
    project_id: string
    brand_name: string
    mode: RedditScanMode
    status: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED"
    keywords: string[]
    post_limit: number
    raw_post_count: number
    unique_post_count: number
    maybe_post_count?: number
    rejected_post_count?: number
    summary: Record<string, unknown>
    posts: AgentsRedditPost[]
    themes: Array<Record<string, unknown>>
    actions: Array<Record<string, unknown>>
    errors: string[]
}
