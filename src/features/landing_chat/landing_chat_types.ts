export type LandingChatIntent =
    | "pricing"
    | "trial"
    | "engines"
    | "setup"
    | "credits"
    | "agencies"
    | "demo"
    | "support"
    | "general"

export interface LandingChatMessageInput {
    message: string
    page_path?: string
}

export interface LandingLeadInput {
    message: string
    email?: string
    name?: string
    company?: string
    page_path?: string
}

export interface LandingChatResponse {
    answer: string
    intent: LandingChatIntent
    suggestions: string[]
    cta?: {
        label: string
        href: string
    }
}
