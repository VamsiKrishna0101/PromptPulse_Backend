import type { Plan, SubscriptionStatus } from "@prisma/client"

export type SupportAgentMessage = {
    role: "user" | "assistant"
    content: string
}

export type SupportAgentChatInput = {
    message: string
    history?: SupportAgentMessage[]
    project_id?: string | null
}

export type SupportAgentTicket = {
    id: string
    email: string
    subject: string
    message: string
    is_resolved: boolean
    created_at: Date
    updated_at: Date
}

export type SupportAgentResponse = {
    answer: string
    escalated: boolean
    needs_confirmation: boolean
    ticket: SupportAgentTicket | null
    category: SupportCategory
    confidence: SupportConfidence
    suggested_actions: string[]
}

export type SupportCategory =
    | "subscription"
    | "billing"
    | "credits"
    | "scraping"
    | "reports"
    | "data_quality"
    | "account"
    | "product"
    | "bug"
    | "manual_review"

export type SupportConfidence = "high" | "medium" | "low"

export type SupportAgentContext = {
    user: {
        id: string
        email: string
        plan: Plan
        effective_plan: Plan
        created_at: Date
    }
    subscription: {
        status: SubscriptionStatus | "FREE" | string
        current_period_start: Date | null
        current_period_end: Date | null
        trial_starts_at: Date | null
        trial_ends_at: Date | null
        trial_active: boolean
        trial_days_left: number
        cancel_at_period_end: boolean
    }
    limits: {
        projects: number
        prompts: number
        competitors: number | "unlimited"
        refreshes_per_week: number | "daily"
        sara: string
        exports: string
        credits: number
    }
    available_plans: {
        id: Plan
        name: string
        monthly_price_usd: number | "custom"
        trial_days: number | null
        summary: string
        limits: {
            projects: number
            prompts: number
            competitors: number | "unlimited"
            refreshes_per_week: number | "daily"
            sara: "none" | "basic" | "full" | "advanced"
            exports: "none" | "basic" | "full"
            credits: number
        }
    }[]
    usage: {
        projects: number
        prompts: number
        competitors: number
        credits_used: number
        credits_remaining: number
        monthly_runs_used: number
    }
    selected_project: {
        id: string
        brand_name: string
        brand_url: string
        brand_location: string
        prompts: number
        competitors: number
        runs: number
        failed_jobs: number
        queued_jobs: number
        running_jobs: number
    } | null
    recent_tickets: {
        id: string
        subject: string
        message: string
        is_resolved: boolean
        created_at: Date
    }[]
}

export type SupportAgentDecision = {
    answer: string
    category: SupportCategory
    confidence: SupportConfidence
    escalate: boolean
    needs_confirmation?: boolean
    escalation_reason?: string
    suggested_actions: string[]
    ticket_subject?: string
    ticket_summary?: string
}
