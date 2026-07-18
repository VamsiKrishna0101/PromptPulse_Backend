import prisma from "../../lib/prisma"
import { generateText } from "../llm/gemini_service"
import { buildCustomerSupportAgentContext } from "./customer_support_agent_context"
import { detectEscalationSignal, inferSupportCategory } from "./customer_support_agent_escalation"
import { buildCustomerSupportAgentSystemPrompt, buildCustomerSupportAgentUserPrompt } from "./customer_support_agent_prompt"
import type {
    SupportAgentChatInput,
    SupportAgentDecision,
    SupportAgentResponse,
    SupportCategory,
    SupportConfidence,
    SupportAgentMessage,
} from "./customer_support_agent_types"

const DEFAULT_ACTIONS = [
    "Explain my subscription",
    "Why are my credits 0?",
    "Scraping/report failed",
    "Need manual review",
]

export async function chatWithCustomerSupportAgent(
    user_id: string,
    input: SupportAgentChatInput
): Promise<SupportAgentResponse> {
    const cleanMessage = input.message.trim()
    if (!cleanMessage) {
        throw new Error("Message is required")
    }

    const history = normalizeHistory(input.history)
    const context = await buildCustomerSupportAgentContext(user_id, input.project_id)
    if (isAvailablePlansQuestion(cleanMessage)) {
        return {
            answer: buildAvailablePlansAnswer(context),
            escalated: false,
            needs_confirmation: false,
            ticket: null,
            category: "subscription",
            confidence: "high",
            suggested_actions: ["Compare Starter and Growth", "What is included in Pro?", "Explain my current limits", "How do credits work?"],
        }
    }
    if (isJobStatusQuestion(cleanMessage)) {
        return {
            answer: buildJobStatusAnswer(context),
            escalated: false,
            needs_confirmation: Boolean(context.selected_project && (context.selected_project.failed_jobs > 0 || context.selected_project.running_jobs > 0)),
            ticket: null,
            category: "scraping",
            confidence: "high",
            suggested_actions: ["Explain my subscription", "What plans are available?", "How do manual runs work?", "Create manual review ticket"],
        }
    }

    const escalationSignal = detectEscalationSignal(cleanMessage, history)
    const category = inferSupportCategory(cleanMessage) as SupportCategory

    const decision = await generateSupportDecision({
        message: cleanMessage,
        history,
        deterministicEscalationReason: escalationSignal.reason,
        context,
        fallbackCategory: category,
    })

    const selfServeCategory = category === "subscription" || category === "credits" || category === "product"
    const confirmedTicketCreation = isTicketCreationConfirmation(cleanMessage, history)
    const needsManualReview = escalationSignal.shouldEscalate
        || confirmedTicketCreation
        || (decision.escalate && !selfServeCategory)
        || (decision.confidence === "low" && !selfServeCategory)
    const shouldCreateTicket = needsManualReview && confirmedTicketCreation
    const finalCategory = needsManualReview && category === "product" ? decision.category : decision.category || category
    const answer = needsManualReview
        ? shouldCreateTicket
            ? ensureTicketCreatedAnswer(decision.answer)
            : ensureConfirmationAnswer(decision.answer, escalationSignal.reason ?? decision.escalation_reason)
        : decision.answer

    const ticket = shouldCreateTicket
        ? await createAgentTicket({
            user_id,
            email: context.user.email,
            message: cleanMessage,
            history,
            decision: {
                ...decision,
                category: finalCategory,
                escalation_reason: escalationSignal.reason ?? decision.escalation_reason,
            },
            contextSummary: {
                plan: context.user.plan,
                effective_plan: context.user.effective_plan,
                subscription_status: context.subscription.status,
                credits_remaining: context.usage.credits_remaining,
                selected_project: context.selected_project?.brand_name ?? null,
            },
        })
        : null

    return {
        answer,
        escalated: Boolean(ticket),
        needs_confirmation: needsManualReview && !ticket,
        ticket,
        category: finalCategory,
        confidence: decision.confidence,
        suggested_actions: normalizeActions(decision.suggested_actions),
    }
}

async function generateSupportDecision(input: {
    message: string
    history: SupportAgentMessage[]
    deterministicEscalationReason: string | null
    context: Awaited<ReturnType<typeof buildCustomerSupportAgentContext>>
    fallbackCategory: SupportCategory
}): Promise<SupportAgentDecision> {
    try {
        const raw = await generateText(
            buildCustomerSupportAgentSystemPrompt(),
            buildCustomerSupportAgentUserPrompt({
                message: input.message,
                history: input.history,
                context: input.context,
                deterministic_escalation_reason: input.deterministicEscalationReason,
            })
        )
        return normalizeDecision(parseJson<Partial<SupportAgentDecision>>(raw), input.fallbackCategory)
    } catch (error) {
        console.warn("[support-agent] generation failed; using deterministic fallback", error)
        return {
            answer: fallbackAnswer(input.message, input.fallbackCategory, input.deterministicEscalationReason),
            category: input.fallbackCategory,
            confidence: input.deterministicEscalationReason ? "medium" : "low",
            escalate: Boolean(input.deterministicEscalationReason),
            escalation_reason: input.deterministicEscalationReason ?? "The agent could not confidently answer this request.",
            suggested_actions: DEFAULT_ACTIONS,
            ticket_subject: supportSubject(input.message, input.fallbackCategory),
            ticket_summary: input.message,
        }
    }
}

function normalizeDecision(value: Partial<SupportAgentDecision>, fallbackCategory: SupportCategory): SupportAgentDecision {
    const answer = typeof value.answer === "string" && value.answer.trim()
        ? value.answer.trim()
        : fallbackAnswer("", fallbackCategory, null)
    const category = isCategory(value.category) ? value.category : fallbackCategory
    const confidence = isConfidence(value.confidence) ? value.confidence : "medium"
    const suggested_actions = Array.isArray(value.suggested_actions)
        ? value.suggested_actions.filter((item): item is string => typeof item === "string").slice(0, 4)
        : DEFAULT_ACTIONS

    return {
        answer,
        category,
        confidence,
        escalate: Boolean(value.escalate),
        escalation_reason: typeof value.escalation_reason === "string" ? value.escalation_reason : "",
        suggested_actions,
        ticket_subject: typeof value.ticket_subject === "string" ? value.ticket_subject : "",
        ticket_summary: typeof value.ticket_summary === "string" ? value.ticket_summary : "",
    }
}

async function createAgentTicket(input: {
    user_id: string
    email: string
    message: string
    history: SupportAgentMessage[]
    decision: SupportAgentDecision
    contextSummary: Record<string, unknown>
}) {
    const subject = truncate(
        input.decision.ticket_subject?.trim() || supportSubject(input.message, input.decision.category),
        150
    )
    const message = [
        "[Created by PromptPulse Support Agent]",
        "",
        `Category: ${input.decision.category}`,
        `Confidence: ${input.decision.confidence}`,
        `Escalation reason: ${input.decision.escalation_reason || "Manual review requested by support agent."}`,
        "",
        "User message:",
        input.message,
        "",
        "Agent attempted answer:",
        input.decision.answer,
        "",
        "Agent summary:",
        input.decision.ticket_summary || input.message,
        "",
        "Account snapshot:",
        JSON.stringify(input.contextSummary, null, 2),
        "",
        "Recent conversation:",
        JSON.stringify(input.history.slice(-8), null, 2),
    ].join("\n")

    return prisma.helpCenter.create({
        data: {
            user_id: input.user_id,
            email: input.email,
            subject,
            message: truncate(message, 5000),
        },
        select: {
            id: true,
            email: true,
            subject: true,
            message: true,
            is_resolved: true,
            created_at: true,
            updated_at: true,
        },
    })
}

function normalizeHistory(history: SupportAgentMessage[] | undefined) {
    if (!Array.isArray(history)) return []
    return history
        .filter(item => (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
        .map(item => ({ role: item.role, content: truncate(item.content.trim(), 1600) }))
        .filter(item => item.content)
        .slice(-10)
}

function ensureConfirmationAnswer(answer: string, reason?: string | null) {
    const clean = stripTicketCreatedClaims(answer)
    if (/do you want me to create|should i create|create a manual review ticket\?/i.test(clean)) return clean
    const reasonLine = reason ? `\n\nWhy this may need review: ${reason}` : ""
    return `${clean}${reasonLine}\n\nDo you want me to create a manual review ticket for this? Reply "yes" and I will create it with your account context attached.`
}

function ensureTicketCreatedAnswer(answer: string) {
    const clean = stripTicketCreatedClaims(answer)
    if (/created|ticket/i.test(clean)) return clean
    return `${clean}\n\nI created a manual review ticket with your account context attached.`
}

function stripTicketCreatedClaims(answer: string) {
    return answer
        .replace(/I also created a manual review ticket[^.]*\./gi, "")
        .replace(/I created a manual review ticket[^.]*\./gi, "")
        .replace(/A manual review ticket has been created[^.]*\./gi, "")
        .trim()
}

function isTicketCreationConfirmation(message: string, history: SupportAgentMessage[]) {
    const clean = message.trim().toLowerCase()
    const confirms = /^(yes|yes please|yep|yeah|ok|okay|sure|create it|create ticket|raise ticket|raise it|do it|please create|go ahead)$/i.test(clean)
        || /\b(create|raise|open)\b.*\b(ticket|manual review)\b/i.test(message)
    if (!confirms) return false

    const recentAssistant = history
        .slice(-4)
        .reverse()
        .find(item => item.role === "assistant")
    if (!recentAssistant) return /\b(ticket|manual review)\b/i.test(message)
    return /manual review ticket|create.*ticket|reply "yes"|reply 'yes'/i.test(recentAssistant.content)
}

function normalizeActions(actions: string[]) {
    const clean = actions.map(item => item.trim()).filter(Boolean)
    return (clean.length ? clean : DEFAULT_ACTIONS).slice(0, 4)
}

function isAvailablePlansQuestion(message: string) {
    return /\b(plans?|pricing|price|tiers?|available plans?|upgrade options?|starter|growth|pro)\b/i.test(message)
        && /\b(available|what|which|tell|list|show|cost|price|pricing|upgrade|compare)\b/i.test(message)
}

function isJobStatusQuestion(message: string) {
    return /\b(today'?s?|runs?|jobs?|scrap(?:e|ing)|queue|queued|running|failed|stuck|worker|refresh)\b/i.test(message)
        && /\b(why|what|status|happened|run|didn'?t|not|failed|stuck|running|today|refresh)\b/i.test(message)
}

function buildAvailablePlansAnswer(context: Awaited<ReturnType<typeof buildCustomerSupportAgentContext>>) {
    const currentPlan = context.user.plan
    const effectivePlan = context.user.effective_plan
    const currentPlanLabel = describeCurrentPlan(context)
    const rows = context.available_plans.map(plan => {
        const price = plan.monthly_price_usd === "custom" ? "Custom" : plan.monthly_price_usd === 0 ? "$0" : `$${plan.monthly_price_usd}/mo`
        const refresh = plan.limits.refreshes_per_week === "daily" ? "Daily" : plan.limits.refreshes_per_week === 0 ? "No auto-refresh" : `${plan.limits.refreshes_per_week}x/week`
        const competitors = plan.limits.competitors === "unlimited" ? "Unlimited" : `${plan.limits.competitors}`
        const trial = plan.trial_days ? `${plan.trial_days}-day trial` : "No trial"
        const currentBadge = plan.id === currentPlan
            ? " (current)"
            : context.subscription.trial_active && plan.id === effectivePlan
                ? " (trial access)"
                : ""
        return `| ${plan.name}${currentBadge} | ${price} | ${plan.limits.projects} | ${plan.limits.prompts} | ${competitors} | ${refresh} | ${plan.limits.credits} | ${trial} |`
    })

    return [
        `You are currently on **${currentPlanLabel}**.`,
        context.subscription.trial_active
            ? `Your trial gives Growth-style access for ${context.subscription.trial_days_left} more day${context.subscription.trial_days_left === 1 ? "" : "s"}, with your prompt cap set by the account context.`
            : "",
        "",
        "Here are the available PromptPulse plans:",
        "",
        "| Plan | Price | Projects | Prompts | Competitors | Refresh | Monthly credits | Trial |",
        "| --- | ---: | ---: | ---: | ---: | --- | ---: | --- |",
        ...rows,
        "",
        "**Quick recommendation:** Starter is for one brand and light monitoring, Growth is the best fit for daily monitoring with Google AI Mode/Copilot, and Pro is for teams or agencies managing more projects and competitors.",
        "",
        `Your current usage: ${context.usage.projects}/${context.limits.projects} projects, ${context.usage.prompts}/${context.limits.prompts} prompts, ${context.usage.competitors}/${formatLimit(context.limits.competitors)} competitors, and ${context.usage.credits_remaining} credits remaining.`,
    ].join("\n")
}

function formatLimit(value: number | "unlimited") {
    return value === "unlimited" ? "unlimited" : String(value)
}

function buildJobStatusAnswer(context: Awaited<ReturnType<typeof buildCustomerSupportAgentContext>>) {
    const project = context.selected_project
    const currentPlanLabel = describeCurrentPlan(context)
    const refresh = context.limits.refreshes_per_week === "daily"
        ? "daily auto-refresh"
        : context.limits.refreshes_per_week === 0
            ? "no scheduled auto-refresh"
            : `${context.limits.refreshes_per_week} scheduled refreshes per week`

    if (!project) {
        return [
            "I do not see a selected project in your account context yet.",
            "",
            `Your current **${currentPlanLabel}** access has **${refresh}**. Manual runs can still be triggered when the project and prompt limits allow it.`,
            "",
            "If you expected a run for an existing project, open that project first and ask me again, or reply **yes** and I can create a manual review ticket.",
        ].join("\n")
    }

    const statusRows = [
        `| Running | ${project.running_jobs} |`,
        `| Queued | ${project.queued_jobs} |`,
        `| Failed | ${project.failed_jobs} |`,
        `| Total runs recorded | ${project.runs} |`,
    ]

    const lines = [
        `For **${project.brand_name}**, here is the job status I can see right now:`,
        "",
        "| Status | Count |",
        "| --- | ---: |",
        ...statusRows,
        "",
        `Your current **${currentPlanLabel}** access has **${refresh}**.`,
        "",
        "Important: the plan controls whether scheduled refreshes run automatically. It does **not** mean manual jobs get stuck because you are on Free, and upgrading will not automatically repair failed jobs.",
        "",
    ]

    if (project.failed_jobs > 0 || project.running_jobs > 0) {
        lines.push(
            "What this usually means:",
            "",
            "- **Running** jobs are currently with the worker/provider or waiting for the async result to complete.",
            "- **Failed** jobs need their error reason checked before retrying.",
            "- If this is local testing, make sure the API, worker, Redis, and Bright Data polling process are running.",
            "",
            "If you want the team to inspect these jobs, reply **yes** and I will create a manual review ticket with this job context attached."
        )
    } else if (context.limits.refreshes_per_week === 0) {
        lines.push("No auto-refresh is expected on Free. To get scheduled runs, upgrade to Starter for 2x/week refresh or Growth/Pro for daily refresh.")
    } else {
        lines.push("I do not see stuck or failed jobs in this project context right now.")
    }

    return lines.join("\n")
}

function describeCurrentPlan(context: Awaited<ReturnType<typeof buildCustomerSupportAgentContext>>) {
    if (context.subscription.trial_active) {
        return `Free Trial (${context.user.effective_plan} access)`
    }
    if (context.subscription.status === "TRIAL_EXPIRED") {
        return "Free Trial ended"
    }
    return context.user.plan
}

function fallbackAnswer(message: string, category: SupportCategory, reason: string | null) {
    if (reason) {
        return "This looks like something our team should review directly. I can create a manual review ticket with your account context and the details from this chat."
    }
    if (category === "subscription" || category === "credits") {
        return "I can help explain your current plan, limits, credits, and usage from your account context. If something looks incorrect, I can create a manual review ticket for the team."
    }
    return message
        ? "I can help with that. If this needs account investigation, I will create a manual review ticket with the relevant context."
        : "How can I help with your PromptPulse account?"
}

function supportSubject(message: string, category: SupportCategory) {
    const prefix = category.replace(/_/g, " ")
    return truncate(`${titleCase(prefix)} support request: ${message}`, 150)
}

function parseJson<T>(raw: string): T {
    let cleaned = raw
        .trim()
        .replace(/^```json\n?/i, "")
        .replace(/^```\n?/i, "")
        .replace(/\n?```$/i, "")
        .trim()
    const firstBrace = cleaned.indexOf("{")
    const lastBrace = cleaned.lastIndexOf("}")
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1)
    }
    return JSON.parse(cleaned) as T
}

function isCategory(value: unknown): value is SupportCategory {
    return typeof value === "string" && [
        "subscription",
        "billing",
        "credits",
        "scraping",
        "reports",
        "data_quality",
        "account",
        "product",
        "bug",
        "manual_review",
    ].includes(value)
}

function isConfidence(value: unknown): value is SupportConfidence {
    return value === "high" || value === "medium" || value === "low"
}

function truncate(value: string, maxLength: number) {
    return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function titleCase(value: string) {
    return value.replace(/\b\w/g, letter => letter.toUpperCase())
}
