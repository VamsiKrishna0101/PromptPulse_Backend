import type { SupportAgentMessage } from "./customer_support_agent_types"

const MANUAL_REVIEW_PATTERNS = [
    /\b(human|manual review|real person|support team|talk to someone|call me)\b/i,
    /\b(not satisfied|not helpful|doesn't help|does not help|still broken|again and again)\b/i,
]

const SENSITIVE_PATTERNS = [
    /\b(refund|chargeback|charged|invoice|payment failed|card|billing dispute|cancel subscription)\b/i,
    /\b(delete account|security|password|unauthorized|compromised|breach|data leak)\b/i,
]

const INVESTIGATION_PATTERNS = [
    /\b(scrape failed|scraping failed|worker failed|brightdata|redis|queue stuck|job failed)\b/i,
    /\b(report failed|pdf failed|pptx failed|export failed|credits deducted|wrong data|data is wrong)\b/i,
    /\b(404|500|error|bug|crash|not working|not loading|blank)\b/i,
]

export type EscalationSignal = {
    shouldEscalate: boolean
    reason: string | null
}

export function detectEscalationSignal(message: string, history: SupportAgentMessage[] = []): EscalationSignal {
    void history
    const currentMessageOnly = message

    if (MANUAL_REVIEW_PATTERNS.some(pattern => pattern.test(currentMessageOnly))) {
        return { shouldEscalate: true, reason: "User requested manual support or is not satisfied." }
    }

    if (SENSITIVE_PATTERNS.some(pattern => pattern.test(currentMessageOnly))) {
        return { shouldEscalate: true, reason: "Sensitive billing, account, or security request." }
    }

    if (INVESTIGATION_PATTERNS.some(pattern => pattern.test(currentMessageOnly))) {
        return { shouldEscalate: true, reason: "Issue likely requires investigation by the team." }
    }

    return { shouldEscalate: false, reason: null }
}

export function inferSupportCategory(message: string) {
    const clean = message.toLowerCase()
    if (/\b(refund|invoice|billing|charged|payment|card|subscription|trial|cancel)\b/.test(clean)) return "billing"
    if (/\b(credit|credits|deducted|balance)\b/.test(clean)) return "credits"
    if (/\b(scrape|scraping|worker|queue|redis|brightdata|job)\b/.test(clean)) return "scraping"
    if (/\b(report|pdf|pptx|export)\b/.test(clean)) return "reports"
    if (/\b(wrong data|data quality|source|citation|competitor|brand wrong)\b/.test(clean)) return "data_quality"
    if (/\b(password|login|otp|account|email)\b/.test(clean)) return "account"
    if (/\b(bug|error|crash|404|500|not working|not loading)\b/.test(clean)) return "bug"
    if (/\b(plan|starter|growth|pro|limit|prompt|project)\b/.test(clean)) return "subscription"
    return "product"
}
