import { Prisma } from "@prisma/client"
import { embedText, generateText, generateTextStream } from "../llm/gemini_service"
import { ingestProjectKnowledge } from "../rag/ingestion_service"
import { searchSaraKnowledge, type QdrantPayload } from "../rag/qdrant_service"
import prisma from "../../lib/prisma"

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
    const readiness = await getSaraReadiness(input.project_id)
    if (!readiness.is_ready) {
        const error = new Error("SARA_NOT_READY")
        ;(error as Error & { details?: unknown }).details = readiness
        throw error
    }
    const scope = await getSaraProjectScope(input.project_id)

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
        formatSaraScope(scope),
        results.map((result, index) => formatEvidence(index + 1, result.payload ?? {})).join("\n\n")
    ].filter(Boolean).join("\n\n")
    const history = recentMessages
        .reverse()
        .map(message => `${message.role}: ${message.content}`)
        .join("\n")
    const raw = await generateText(buildSaraSystemPrompt(), buildSaraUserPrompt(input.message, evidence, history, input.page_context, scope))
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
    const readiness = await getSaraReadiness(input.project_id)
    if (!readiness.is_ready) {
        const error = new Error("SARA_NOT_READY")
        ;(error as Error & { details?: unknown }).details = readiness
        throw error
    }
    const scope = await getSaraProjectScope(input.project_id)

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
        formatSaraScope(scope),
        results.map((result, index) => formatEvidence(index + 1, result.payload ?? {})).join("\n\n")
    ].filter(Boolean).join("\n\n")
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
        buildSaraStreamingSystemPrompt(),
        buildSaraStreamingUserPrompt(input.message, evidence, history, input.page_context, scope),
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
        is_ready: days_available >= 7,
        days_available,
        required_days: 7,
        total_chats: aggregate._count._all,
        first_chat_at: first,
        last_chat_at: last,
        recommendations: days_available >= 7 ? buildInitialRecommendations() : []
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

function buildSaraSystemPrompt() {
    return [
        "You are Sara, an AI brand visibility consultant.",
        "Write like an enterprise product analyst: concise, specific, and calm.",
        "Keep the answer to 2 short paragraphs unless the user explicitly asks for a detailed plan.",
        "Avoid generic marketing advice and avoid repeating the user's dashboard numbers unless they answer the question.",
        "Answer only from the supplied project evidence.",
        "Treat only the project's tracked competitor list as competitors. Other brands mentioned in scraped AI answers are evidence only, not competitors, unless they are in that tracked list.",
        "If the evidence is insufficient, say what is missing instead of inventing facts.",
        "Return strict JSON with keys: answer, citations, suggested_actions, confidence.",
        "citations must reference evidence numbers from the context, like E1 or E2.",
        "suggested_actions should contain 0 to 2 short action labels only, not full sentences, and only when they add value."
    ].join("\n")
}

function buildSaraUserPrompt(message: string, evidence: string, history: string, pageContext?: string, scope?: SaraProjectScope) {
    return [
        pageContext ? `Current product area: ${pageContext}` : "",
        scope ? `Brand: ${scope.brand_name}` : "",
        scope ? `Tracked competitors: ${scope.tracked_competitors.join(", ") || "None configured"}` : "",
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

function buildSaraStreamingSystemPrompt() {
    return [
        "You are Sara, an AI brand visibility consultant.",
        "Write like an enterprise product analyst: concise, specific, and calm.",
        "Answer in plain text only. Do not return JSON, markdown tables, or headings unless the user asks for a plan.",
        "Keep the answer to 2 short paragraphs unless the user explicitly asks for detail.",
        "Avoid generic marketing advice and avoid repeating dashboard numbers unless they answer the question.",
        "Answer only from the supplied project evidence.",
        "Treat only the project's tracked competitor list as competitors. Other brands mentioned in scraped AI answers are evidence only, not competitors, unless they are in that tracked list.",
        "If the evidence is insufficient, say what is missing instead of inventing facts."
    ].join("\n")
}

function buildSaraStreamingUserPrompt(message: string, evidence: string, history: string, pageContext?: string, scope?: SaraProjectScope) {
    return [
        pageContext ? `Current product area: ${pageContext}` : "",
        scope ? `Brand: ${scope.brand_name}` : "",
        scope ? `Tracked competitors: ${scope.tracked_competitors.join(", ") || "None configured"}` : "",
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
            reason: readPayloadString(payload.document_type) || "Relevant Sara knowledge"
        }
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
        return JSON.parse(cleaned) as {
            answer: string
            citations: { evidence_id: string; title: string; reason: string }[]
            suggested_actions: string[]
            confidence: "low" | "medium" | "high"
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

type SaraProjectScope = {
    brand_name: string
    tracked_competitors: string[]
}

async function getSaraProjectScope(project_id: string): Promise<SaraProjectScope> {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: project_id },
        include: { competitors: { select: { name: true } } }
    })

    return {
        brand_name: project.brand_name,
        tracked_competitors: project.competitors.map(competitor => competitor.name)
    }
}

function formatSaraScope(scope: SaraProjectScope) {
    return [
        "Project scope guard:",
        `Brand: ${scope.brand_name}`,
        `Tracked competitors: ${scope.tracked_competitors.join(", ") || "None configured"}`,
        "Important: Only these tracked competitors should be treated as competitors in Sara's answer."
    ].join("\n")
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
