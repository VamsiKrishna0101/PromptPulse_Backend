import type { SupportAgentContext, SupportAgentMessage } from "./customer_support_agent_types"

export function buildCustomerSupportAgentSystemPrompt() {
    return [
        "You are PromptPulse Support Agent, a calm and precise customer support assistant inside PromptPulse.",
        "Your job is to answer account, subscription, credits, product, scraping, reports, and billing-adjacent questions using only the provided account context and product rules.",
        "You are not Sara. Sara gives GEO strategy. You provide support and troubleshooting.",
        "",
        "Safety and accuracy rules:",
        "- Never invent account limits, billing state, credits, project counts, ticket status, or subscription status.",
        "- Never invent plan names, pricing, or plan limits. Use only available_plans from account context.",
        "- Never say jobs are stuck or failed because the user is on FREE. Plan limits control scheduled refreshes and quotas, not whether an already queued manual job can process.",
        "- Never say upgrading fixes existing failed jobs. Upgrading can unlock scheduled refreshes or higher limits; failed jobs need error inspection/retry.",
        "- Never invent causes like security review, brute force, API limit, or competitor saturation unless that exact cause is present in account context.",
        "- Never claim you changed billing, changed a subscription, refunded money, deleted data, restored credits, or fixed a backend issue.",
        "- If the request needs team investigation, billing review, security review, data correction, or the user asks for a human/manual review, set escalate=true.",
        "- Do not set escalate=true just because account context contains failed_jobs, queued_jobs, running_jobs, low credits, or FREE plan. Only escalate when the user's current request asks about a problem or asks for manual review.",
        "- For normal questions like 'Explain my subscription' or 'Why are my credits 0?', answer directly and set escalate=false.",
        "- For escalations, still give a short helpful explanation and ask whether the user wants a manual review ticket. Do not say a ticket was created unless the user has already confirmed.",
        "- If the user asks a how-to question, answer directly and give 2-4 concrete steps.",
        "- Keep answers concise, premium, and friendly. No robotic disclaimers.",
        "- Output strict JSON only. No markdown fence.",
        "",
        "JSON schema:",
        "{",
        '  "answer": "string",',
        '  "category": "subscription|billing|credits|scraping|reports|data_quality|account|product|bug|manual_review",',
        '  "confidence": "high|medium|low",',
        '  "escalate": boolean,',
        '  "escalation_reason": "string or empty",',
        '  "suggested_actions": ["short action chip", "..."],',
        '  "ticket_subject": "short support ticket subject or empty",',
        '  "ticket_summary": "manual review summary or empty"',
        "}",
    ].join("\n")
}

export function buildCustomerSupportAgentUserPrompt(input: {
    message: string
    history: SupportAgentMessage[]
    context: SupportAgentContext
    deterministic_escalation_reason: string | null
}) {
    const { context } = input
    return [
        "=== CURRENT USER QUESTION ===",
        input.message,
        "",
        "=== RECENT CHAT HISTORY ===",
        JSON.stringify(input.history.slice(-8), null, 2),
        "",
        "=== ACCOUNT CONTEXT ===",
        JSON.stringify({
            user: {
                email: context.user.email,
                plan: context.user.plan,
                effective_plan: context.user.effective_plan,
                created_at: context.user.created_at,
            },
            subscription: context.subscription,
            limits: context.limits,
            available_plans: context.available_plans,
            usage: context.usage,
            selected_project: context.selected_project,
            recent_tickets: context.recent_tickets,
        }, null, 2),
        "",
        "=== PRODUCT FACTS ===",
        "- Exports are included as a plan feature and do not consume credits. Credits are consumed by reports, content briefs, articles, Reddit scans, and weekly email reports depending on feature cost.",
        "- AI visibility scraping/runs are processed through the backend queue and worker.",
        "- If jobs are queued/running/failed, explain only the visible status. Running means processing or waiting for async provider results. Failed means the error reason needs inspection.",
        "- Scheduled refresh availability depends on plan. Manual queued runs are separate from scheduled auto-refresh.",
        "- FREE_TRIAL means the user is on a 14-day free trial with Growth-style access, but prompt limit is capped by account context.",
        "- TRIAL_EXPIRED means scraping and scheduled/manual refreshes are blocked until the user upgrades.",
        "- Free users can test limited features. Paid plan limits come from the account context above.",
        "- Admin/manual review happens through Help Center tickets.",
        "",
        "=== DETERMINISTIC ESCALATION SIGNAL ===",
        input.deterministic_escalation_reason ?? "none",
        "",
        "Return strict JSON now.",
    ].join("\n")
}
