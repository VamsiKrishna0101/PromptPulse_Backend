import { Prisma } from "@prisma/client"
import { embedText, generateText, generateTextStream } from "../llm/gemini_service"
import { ingestProjectKnowledge } from "../rag/ingestion_service"
import { searchSaraKnowledge, type QdrantPayload } from "../rag/qdrant_service"
import prisma from "../../lib/prisma"
import { buildSaraContextPacket, type SaraContextPacket } from "./context/sara_context_service"
import { getEffectivePlanAccess } from "../subscription/entitlements"

type SaraDebugTrace = {
    internal_mcp: {
        used: boolean
        tool_names: string[]
        section_titles: string[]
    }
    rag: {
        used: boolean
        result_count: number
        document_types: string[]
        top_titles: string[]
    }
}

// PAYG: Sara has no daily message limit — all users have full access
async function checkSaraDailyLimit(_user_id: string) {
    // No limits in PAYG model
}

export async function reindexSaraProject(project_id: string, options?: {
    chat_limit?: number
    source_limit?: number
}) {
    return ingestProjectKnowledge(project_id, options)
}

export async function searchSaraProject(input: {
    user_id: string
    project_id: string
    query: string
    limit?: number
    document_types?: string[]
}) {
    const vector = await embedText(input.query)
    return searchSaraKnowledge({
        vector,
        user_id: input.user_id,
        project_id: input.project_id,
        limit: input.limit,
        document_types: input.document_types
    })
}

export async function chatWithSara(input: {
    user_id: string
    project_id: string
    message: string
    conversation_id?: string
    page_context?: string
    limit?: number
}) {
    await checkSaraDailyLimit(input.user_id)

    const readiness = await getSaraReadiness(input.project_id)
    if (!readiness.is_ready) {
        const error = new Error("SARA_NOT_READY")
        ;(error as Error & { details?: unknown }).details = readiness
        throw error
    }
    const contextPacket = await buildSaraContextPacket(input)
    const scope = toSaraProjectScope(contextPacket)

    const conversation = await getOrCreateConversation({
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        project_id: input.project_id,
        message: input.message
    })

    const recentMessages = await prisma.saraMessage.findMany({
        where: { conversation_id: conversation.id },
        orderBy: { created_at: "desc" },
        take: 8
    })

    const results = await searchSaraProject({
        user_id: input.user_id,
        project_id: input.project_id,
        query: `${input.page_context ? `${input.page_context}\n` : ""}${input.message}`,
        limit: input.limit ?? 8
    })

    const evidence = [
        "Premium live facts packet:",
        contextPacket.text,
        "Retrieved RAG evidence:",
        formatSaraScope(scope),
        results.map((result, index) => formatEvidence(index + 1, result.payload ?? {})).join("\n\n")
    ].filter(Boolean).join("\n\n")
    const debugTrace = buildSaraDebugTrace(contextPacket, results)
    logSaraDebug(input.project_id, input.message, debugTrace)
    const history = recentMessages
        .reverse()
        .map(message => `${message.role}: ${message.content}`)
        .join("\n")
    const raw = await generateText(
        buildSaraSystemPrompt(contextPacket),
        buildSaraUserPrompt(input.message, evidence, history, input.page_context, scope, contextPacket)
    )
    const parsed = parseSaraJson(raw)
    const retrievedContext = results.map(result => ({
        score: result.score,
        payload: result.payload ?? null
    })) as Prisma.InputJsonValue

    await prisma.saraMessage.create({
        data: {
            conversation_id: conversation.id,
            role: "USER",
            content: input.message
        }
    })

    const assistantMessage = await prisma.saraMessage.create({
        data: {
            conversation_id: conversation.id,
            role: "ASSISTANT",
            content: parsed.answer,
            citations: parsed.citations,
            suggested_actions: parsed.suggested_actions,
            retrieved_context: retrievedContext,
            confidence: parsed.confidence
        }
    })

    await prisma.saraConversation.update({
        where: { id: conversation.id },
        data: { updated_at: new Date() }
    })

    return {
        conversation_id: conversation.id,
        message_id: assistantMessage.id,
        ...parsed,
        debug: debugTrace,
        retrieved_context: results.map(result => ({
            score: result.score,
            payload: result.payload
        }))
    }
}

export async function chatWithSaraStream(input: {
    user_id: string
    project_id: string
    message: string
    conversation_id?: string
    page_context?: string
    limit?: number
    onReady?: (payload: { conversation_id: string }) => void
    onToken: (token: string) => void
}) {
    await checkSaraDailyLimit(input.user_id)

    const readiness = await getSaraReadiness(input.project_id)
    if (!readiness.is_ready) {
        const error = new Error("SARA_NOT_READY")
        ;(error as Error & { details?: unknown }).details = readiness
        throw error
    }
    const contextPacket = await buildSaraContextPacket(input)
    const scope = toSaraProjectScope(contextPacket)

    const conversation = await getOrCreateConversation({
        conversation_id: input.conversation_id,
        user_id: input.user_id,
        project_id: input.project_id,
        message: input.message
    })

    const recentMessages = await prisma.saraMessage.findMany({
        where: { conversation_id: conversation.id },
        orderBy: { created_at: "desc" },
        take: 8
    })

    const results = await searchSaraProject({
        user_id: input.user_id,
        project_id: input.project_id,
        query: `${input.page_context ? `${input.page_context}\n` : ""}${input.message}`,
        limit: input.limit ?? 8
    })

    const evidence = [
        "Premium live facts packet:",
        contextPacket.text,
        "Retrieved RAG evidence:",
        formatSaraScope(scope),
        results.map((result, index) => formatEvidence(index + 1, result.payload ?? {})).join("\n\n")
    ].filter(Boolean).join("\n\n")
    const debugTrace = buildSaraDebugTrace(contextPacket, results)
    logSaraDebug(input.project_id, input.message, debugTrace)
    const history = recentMessages
        .reverse()
        .map(message => `${message.role}: ${message.content}`)
        .join("\n")
    const retrievedContext = results.map(result => ({
        score: result.score,
        payload: result.payload ?? null
    })) as Prisma.InputJsonValue

    await prisma.saraMessage.create({
        data: {
            conversation_id: conversation.id,
            role: "USER",
            content: input.message
        }
    })

    input.onReady?.({ conversation_id: conversation.id })

    const answer = await generateTextStream(
        buildSaraStreamingSystemPrompt(contextPacket),
        buildSaraStreamingUserPrompt(input.message, evidence, history, input.page_context, scope, contextPacket),
        input.onToken
    )

    const assistantMessage = await prisma.saraMessage.create({
        data: {
            conversation_id: conversation.id,
            role: "ASSISTANT",
            content: answer,
            citations: buildStreamingCitations(results),
            suggested_actions: [],
            retrieved_context: retrievedContext,
            confidence: results.length > 0 ? "medium" : "low"
        }
    })

    await prisma.saraConversation.update({
        where: { id: conversation.id },
        data: { updated_at: new Date() }
    })

    return {
        conversation_id: conversation.id,
        message_id: assistantMessage.id,
        answer,
        citations: buildStreamingCitations(results),
        suggested_actions: [],
        confidence: results.length > 0 ? "medium" as const : "low" as const,
        debug: debugTrace,
        retrieved_context: results.map(result => ({
            score: result.score,
            payload: result.payload
        }))
    }
}

export async function getSaraReadiness(project_id: string) {
    const aggregate = await prisma.chat.aggregate({
        where: { run: { project_id } },
        _count: { _all: true },
        _min: { created_at: true },
        _max: { created_at: true }
    })

    const first = aggregate._min.created_at
    const last = aggregate._max.created_at
    const days_available = first && last
        ? Math.floor((last.getTime() - first.getTime()) / 86400000) + 1
        : 0

    return {
        is_ready: days_available >= 1,
        days_available,
        required_days: 1,
        total_chats: aggregate._count._all,
        first_chat_at: first,
        last_chat_at: last,
        recommendations: days_available >= 1 ? buildInitialRecommendations() : []
    }
}

export async function getSaraConversations(input: {
    user_id: string
    project_id: string
}) {
    return prisma.saraConversation.findMany({
        where: {
            project_id: input.project_id,
            user_id: input.user_id
        },
        orderBy: { updated_at: "desc" },
        take: 30,
        include: {
            messages: {
                orderBy: { created_at: "desc" },
                take: 1
            }
        }
    })
}

export async function getSaraMessages(input: {
    user_id: string
    project_id: string
    conversation_id: string
}) {
    const conversation = await prisma.saraConversation.findFirst({
        where: {
            id: input.conversation_id,
            project_id: input.project_id,
            user_id: input.user_id
        }
    })

    if (!conversation) throw new Error("SARA_CONVERSATION_NOT_FOUND")

    return prisma.saraMessage.findMany({
        where: { conversation_id: input.conversation_id },
        orderBy: { created_at: "asc" }
    })
}

async function getOrCreateConversation(input: {
    conversation_id?: string
    user_id: string
    project_id: string
    message: string
}) {
    if (input.conversation_id) {
        const existing = await prisma.saraConversation.findFirst({
            where: {
                id: input.conversation_id,
                user_id: input.user_id,
                project_id: input.project_id
            }
        })

        if (!existing) throw new Error("SARA_CONVERSATION_NOT_FOUND")
        return existing
    }

    return prisma.saraConversation.create({
        data: {
            user_id: input.user_id,
            project_id: input.project_id,
            title: makeConversationTitle(input.message)
        }
    })
}

function buildSaraSystemPrompt(context: SaraContextPacket) {
    return [
        "You are Sara, an AI brand visibility consultant.",
        "Write like an enterprise product analyst: concise, specific, and calm.",
        "Keep the answer to 2 short paragraphs unless the user explicitly asks for a detailed plan.",
        "Avoid generic marketing advice and avoid repeating the user's dashboard numbers unless they answer the question.",
        "Never upsell, mention upgrading, or describe locked features unless the user asks about billing, limits, upgrades, or is blocked by a plan limit.",
        "Never claim the user is on a free tier, lacks URL-level reporting, or has a feature limitation unless the live plan packet explicitly says that exact limit is blocking the request.",
        "If URL-level source details are not present in the supplied evidence, say the current packet has domain-level source data and ask the user to open Sources for URL-level rows; do not blame the plan.",
        "If the user asks what you can do, answer as a PromptPulse in-product analyst: dashboard summaries, prompt diagnosis, competitor comparison, source gaps, action queue, reports, and next steps.",
        "If the user asks for a table, tabular format, comparison, dashboard summary, or beautiful summary, put a markdown table first, then add 2-3 concise bullets.",
        "Markdown table rule: every table row must be on its own line, with a blank line before and after the table. Never compress a table into one paragraph.",
        "For rank/position metrics, lower numbers are better. Say '#2.4 is stronger than #3.3' rather than calling 3.3 higher/better.",
        "For today's dashboard questions, summarize visibility, average position, sentiment, responses analyzed, weak prompt areas, competitor signals, source gaps, and next actions.",
        "Use the Premium live facts packet first for dashboard, plan, usage, run status, source, competitor, and action queue questions.",
        "Use retrieved RAG evidence as supporting evidence for specific chats, prompts, sources, and historical details.",
        "Answer only from the supplied project evidence and live facts packet.",
        "Treat only the project's tracked competitor list as competitors. Other brands mentioned in scraped AI answers are evidence only, not competitors, unless they are in that tracked list.",
        "If the evidence is insufficient, say what is missing instead of inventing facts.",
        `Current Sara mode: ${context.plan.sara_level} for ${context.plan.plan}.`,
        `Plan-specific behavior: ${context.plan.guidance}`,
        "Return strict JSON with keys: answer, citations, suggested_actions, confidence.",
        "citations must reference evidence numbers from the context, like E1 or E2.",
        "suggested_actions should contain 0 to 2 short action labels only, not full sentences, and only when they add value."
    ].join("\n")
}

function buildSaraUserPrompt(message: string, evidence: string, history: string, pageContext?: string, scope?: SaraProjectScope, context?: SaraContextPacket) {
    return [
        pageContext ? `Current product area: ${pageContext}` : "",
        scope ? `Brand: ${scope.brand_name}` : "",
        scope ? `Tracked competitors: ${scope.tracked_competitors.join(", ") || "None configured"}` : "",
        context ? `Sara mode: ${context.plan.sara_level} (${context.plan.plan})` : "",
        history ? `Recent conversation:\n${history}` : "",
        "",
        `User question: ${message}`,
        "",
        "Project evidence:",
        evidence || "No relevant evidence was retrieved.",
        "",
        "Return JSON only in this shape:",
        JSON.stringify({
            answer: "string",
            citations: [{ evidence_id: "E1", title: "string", reason: "string" }],
            suggested_actions: ["short action label"],
            confidence: "low|medium|high"
        })
    ].join("\n")
}

function buildSaraStreamingSystemPrompt(context: SaraContextPacket) {
    return [
        "You are Sara, an AI brand visibility consultant.",
        "Write like an enterprise product analyst: concise, specific, and calm.",
        "Answer in plain text or markdown when it improves clarity. Do not return JSON in streaming mode.",
        "Keep the answer to 2 short paragraphs unless the user explicitly asks for detail.",
        "Avoid generic marketing advice and avoid repeating dashboard numbers unless they answer the question.",
        "Never upsell, mention upgrading, or describe locked features unless the user asks about billing, limits, upgrades, or is blocked by a plan limit.",
        "Never claim the user is on a free tier, lacks URL-level reporting, or has a feature limitation unless the live plan packet explicitly says that exact limit is blocking the request.",
        "If URL-level source details are not present in the supplied evidence, say the current packet has domain-level source data and ask the user to open Sources for URL-level rows; do not blame the plan.",
        "If the user asks what you can do, answer as a PromptPulse in-product analyst: dashboard summaries, prompt diagnosis, competitor comparison, source gaps, action queue, reports, and next steps.",
        "If the user asks for a table, tabular format, comparison, dashboard summary, or beautiful summary, put a markdown table first, then add 2-3 concise bullets.",
        "Markdown table rule: every table row must be on its own line, with a blank line before and after the table. Never compress a table into one paragraph.",
        "For rank/position metrics, lower numbers are better. Say '#2.4 is stronger than #3.3' rather than calling 3.3 higher/better.",
        "For today's dashboard questions, summarize visibility, average position, sentiment, responses analyzed, weak prompt areas, competitor signals, source gaps, and next actions.",
        "Use the Premium live facts packet first for dashboard, plan, usage, run status, source, competitor, and action queue questions.",
        "Use retrieved RAG evidence as supporting evidence for specific chats, prompts, sources, and historical details.",
        "Answer only from the supplied project evidence and live facts packet.",
        "Treat only the project's tracked competitor list as competitors. Other brands mentioned in scraped AI answers are evidence only, not competitors, unless they are in that tracked list.",
        "If the evidence is insufficient, say what is missing instead of inventing facts.",
        `Current Sara mode: ${context.plan.sara_level} for ${context.plan.plan}.`,
        `Plan-specific behavior: ${context.plan.guidance}`
    ].join("\n")
}

function buildSaraStreamingUserPrompt(message: string, evidence: string, history: string, pageContext?: string, scope?: SaraProjectScope, context?: SaraContextPacket) {
    return [
        pageContext ? `Current product area: ${pageContext}` : "",
        scope ? `Brand: ${scope.brand_name}` : "",
        scope ? `Tracked competitors: ${scope.tracked_competitors.join(", ") || "None configured"}` : "",
        context ? `Sara mode: ${context.plan.sara_level} (${context.plan.plan})` : "",
        history ? `Recent conversation:\n${history}` : "",
        "",
        `User question: ${message}`,
        "",
        "Project evidence:",
        evidence || "No relevant evidence was retrieved."
    ].join("\n")
}

function buildStreamingCitations(results: Awaited<ReturnType<typeof searchSaraProject>>) {
    return results.slice(0, 3).map((result, index) => {
        const payload = result.payload ?? {}
        return {
            evidence_id: `E${index + 1}`,
            title: readPayloadString(payload.title) || readPayloadString(payload.source_entity) || "Project evidence",
            reason: friendlyEvidenceReason(readPayloadString(payload.document_type))
        }
    })
}

function buildSaraDebugTrace(
    contextPacket: SaraContextPacket,
    results: Awaited<ReturnType<typeof searchSaraProject>>
): SaraDebugTrace {
    const documentTypes = new Set<string>()
    const topTitles: string[] = []

    for (const result of results) {
        const payload = result.payload ?? {}
        const documentType = readPayloadString(payload.document_type)
        const title = readPayloadString(payload.title) || readPayloadString(payload.source_entity)
        if (documentType) documentTypes.add(documentType)
        if (title && topTitles.length < 5) topTitles.push(title)
    }

    return {
        internal_mcp: {
            used: true,
            tool_names: contextPacket.debug.tool_names,
            section_titles: contextPacket.debug.section_titles,
        },
        rag: {
            used: results.length > 0,
            result_count: results.length,
            document_types: Array.from(documentTypes),
            top_titles: topTitles,
        },
    }
}

function logSaraDebug(projectId: string, message: string, debug: SaraDebugTrace) {
    console.info("[sara-debug]", {
        project_id: projectId,
        question: message.slice(0, 120),
        internal_mcp_tools: debug.internal_mcp.tool_names,
        rag_results: debug.rag.result_count,
        rag_document_types: debug.rag.document_types,
        rag_top_titles: debug.rag.top_titles,
    })
}

function formatEvidence(index: number, payload: QdrantPayload) {
    return [
        `E${index}`,
        `Title: ${readPayloadString(payload.title) || "Untitled"}`,
        `Type: ${readPayloadString(payload.document_type) || "unknown"}`,
        `Source: ${readPayloadString(payload.source_entity) || "unknown"}:${readPayloadString(payload.source_entity_id) || "unknown"}`,
        `URL: ${readPayloadString(payload.url) || "n/a"}`,
        `Text: ${readPayloadString(payload.text).slice(0, 2400)}`
    ].join("\n")
}

function parseSaraJson(raw: string) {
    const cleaned = raw
        .replace(/^```json\n?/i, "")
        .replace(/^```\n?/i, "")
        .replace(/\n?```$/i, "")
        .trim()

    try {
        const parsed = JSON.parse(cleaned) as {
            answer: string
            citations: { evidence_id: string; title: string; reason: string }[]
            suggested_actions: string[]
            confidence: "low" | "medium" | "high"
        }

        return {
            ...parsed,
            citations: (parsed.citations ?? []).map(citation => ({
                ...citation,
                reason: friendlyEvidenceReason(citation.reason)
            }))
        }
    } catch {
        return {
            answer: cleaned,
            citations: [],
            suggested_actions: [],
            confidence: "low" as const
        }
    }
}

function readPayloadString(value: unknown) {
    return typeof value === "string" ? value : ""
}

function friendlyEvidenceReason(documentType: string) {
    const labels: Record<string, string> = {
        project_profile: "Project profile",
        prompt_definition: "Prompt evidence",
        chat_response: "AI response evidence",
        source_content: "Source evidence",
        project_summary_snapshot: "Dashboard summary",
    }
    return labels[documentType] ?? (documentType || "Relevant Sara knowledge")
}

type SaraProjectScope = {
    brand_name: string
    tracked_competitors: string[]
}

function formatSaraScope(scope: SaraProjectScope) {
    return [
        "Project scope guard:",
        `Brand: ${scope.brand_name}`,
        `Tracked competitors: ${scope.tracked_competitors.join(", ") || "None configured"}`,
        "Important: Only these tracked competitors should be treated as competitors in Sara's answer."
    ].join("\n")
}

function toSaraProjectScope(context: SaraContextPacket): SaraProjectScope {
    return {
        brand_name: context.project.brand_name,
        tracked_competitors: context.project.tracked_competitors
    }
}

function makeConversationTitle(message: string) {
    const normalized = message.replace(/\s+/g, " ").trim()
    if (normalized.length <= 52) return normalized
    return `${normalized.slice(0, 49).trim()}...`
}

function buildInitialRecommendations() {
    return [
        "Summarize my brand visibility this week",
        "What should we fix first?",
        "Which competitors are gaining on us?",
        "What sources should we target next?"
    ]
}
