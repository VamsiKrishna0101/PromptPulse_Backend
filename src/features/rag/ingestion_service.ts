import crypto from "crypto"
import type { Chat, Prompt, Project, SourceUrlContent } from "@prisma/client"
import prisma from "../../lib/prisma"
import { embedText } from "../llm/gemini_service"
import { deleteSaraPointsBySource, stablePointId, upsertSaraPoints, type QdrantPayload, type QdrantPoint } from "./qdrant_service"

type SaraDocumentType =
    | "project_profile"
    | "prompt_definition"
    | "chat_response"
    | "source_content"
    | "project_summary_snapshot"

type SaraDocument = {
    document_type: SaraDocumentType
    source_entity: string
    source_entity_id: string
    title: string
    text: string
    metadata?: QdrantPayload
    updated_at: Date
}

type ProjectIngestionOptions = {
    chat_limit?: number
    source_limit?: number
}

const INGESTION_VERSION = "2026-07-04"
const SOURCE_CHUNK_CHARS = Number(process.env.SARA_SOURCE_CHUNK_CHARS ?? 2400)
const SOURCE_CHUNK_OVERLAP = Number(process.env.SARA_SOURCE_CHUNK_OVERLAP ?? 320)

export async function ingestProjectKnowledge(project_id: string, options: ProjectIngestionOptions = {}) {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: project_id },
        include: {
            competitors: true,
            prompts: true
        }
    })

    const docs: SaraDocument[] = [
        buildProjectProfileDocument(project),
        ...project.prompts.map(prompt => buildPromptDocument(prompt)),
        await buildProjectSummaryDocument(project)
    ]

    for (const doc of docs) {
        await ingestSaraDocument(project.user_id, project.id, doc)
    }

    const chats = await prisma.chat.findMany({
        where: { run: { project_id } },
        orderBy: { created_at: "desc" },
        take: clampLimit(options.chat_limit, Number(process.env.SARA_REINDEX_CHAT_LIMIT ?? 500)),
        select: { id: true }
    })

    for (const chat of chats) {
        await ingestChatById(chat.id)
    }

    const sourceContents = await prisma.sourceUrlContent.findMany({
        where: {
            sources: {
                some: {
                    chat: {
                        run: { project_id }
                    }
                }
            }
        },
        take: clampLimit(options.source_limit, Number(process.env.SARA_REINDEX_SOURCE_LIMIT ?? 500)),
        select: { id: true }
    })

    for (const source of sourceContents) {
        await ingestSourceContentById(source.id, project_id)
    }

    return {
        project_documents: docs.length,
        chats: chats.length,
        sources: sourceContents.length
    }
}

export async function ingestChatById(chat_id: string) {
    const chat = await prisma.chat.findUniqueOrThrow({
        where: { id: chat_id },
        include: {
            prompt: true,
            brand_mentions: true,
            sources: true,
            run: { include: { project: { include: { competitors: true } } } }
        }
    })

    await ingestSaraDocument(
        chat.run.project.user_id,
        chat.run.project_id,
        buildChatDocument(chat)
    )
}

export async function ingestSourceContentById(source_url_content_id: string, project_id?: string) {
    const content = await prisma.sourceUrlContent.findUniqueOrThrow({
        where: { id: source_url_content_id },
        include: {
            sources: {
                include: {
                    chat: {
                        include: {
                            run: { include: { project: true } }
                        }
                    }
                }
            }
        }
    })

    const relatedProjects = new Map<string, { user_id: string; brand_name: string; competitors: { name: string }[] }>()
    for (const source of content.sources) {
        const project = await prisma.project.findUniqueOrThrow({
            where: { id: source.chat.run.project.id },
            include: { competitors: { select: { name: true } } }
        })
        if (!project_id || project.id === project_id) {
            relatedProjects.set(project.id, {
                user_id: project.user_id,
                brand_name: project.brand_name,
                competitors: project.competitors
            })
        }
    }

    for (const [projectId, project] of relatedProjects) {
        await ingestSaraDocument(
            project.user_id,
            projectId,
            buildSourceContentDocument(content, projectId, project)
        )
    }
}

async function ingestSaraDocument(user_id: string, project_id: string, doc: SaraDocument) {
    const contentHash = hashText(doc.text)
    const chunks = chunkDocument(doc)
    const points: QdrantPoint[] = []

    for (const [index, chunkText] of chunks.entries()) {
        const stableKey = `${project_id}:${doc.source_entity}:${doc.source_entity_id}:${contentHash}:${index}`
        const vector = await embedText(chunkText)
        points.push({
            id: stablePointId(stableKey),
            vector,
            payload: {
                user_id,
                project_id,
                document_type: doc.document_type,
                source_entity: doc.source_entity,
                source_entity_id: doc.source_entity_id,
                chunk_index: index,
                chunk_count: chunks.length,
                content_hash: contentHash,
                ingestion_version: INGESTION_VERSION,
                title: doc.title,
                text: chunkText,
                updated_at: doc.updated_at.toISOString(),
                ...doc.metadata
            }
        })
    }

    await deleteSaraPointsBySource({
        project_id,
        source_entity: doc.source_entity,
        source_entity_id: doc.source_entity_id
    }).catch(error => {
        if (isMissingCollectionError(error)) return
        throw error
    })

    await upsertSaraPoints(points)
}

function buildProjectProfileDocument(project: Project & { competitors: { name: string; url: string | null }[] }): SaraDocument {
    const competitors = project.competitors.length
        ? project.competitors.map(item => `${item.name}${item.url ? ` (${item.url})` : ""}`).join(", ")
        : "No tracked competitors yet."

    return {
        document_type: "project_profile",
        source_entity: "project",
        source_entity_id: project.id,
        title: `${project.brand_name} project profile`,
        text: [
            `Brand: ${project.brand_name}`,
            `Website: ${project.brand_url}`,
            `Primary location: ${project.brand_location}`,
            `Tracked competitors: ${competitors}`
        ].join("\n"),
        updated_at: project.updated_at,
        metadata: {
            brand_name: project.brand_name,
            brand_url: project.brand_url,
            brand_location: project.brand_location,
            competitors: project.competitors.map(item => item.name)
        }
    }
}

function buildPromptDocument(prompt: Prompt): SaraDocument {
    return {
        document_type: "prompt_definition",
        source_entity: "prompt",
        source_entity_id: prompt.id,
        title: `Prompt: ${prompt.topic}`,
        text: [
            `Prompt: ${prompt.text}`,
            `Topic: ${prompt.topic}`,
            `Type: ${prompt.type}`,
            `Status: ${prompt.status}`,
            `Tags: ${prompt.tags.join(", ") || "None"}`,
            `Last run: ${prompt.last_run_at?.toISOString() ?? "Never"}`
        ].join("\n"),
        updated_at: prompt.updated_at,
        metadata: {
            prompt_id: prompt.id,
            topic: prompt.topic,
            tags: prompt.tags,
            prompt_status: prompt.status
        }
    }
}

function buildChatDocument(chat: Chat & {
    prompt: Prompt
    brand_mentions: { brand_name: string; position: number | null; sentiment_score: number | null }[]
    sources: { url: string; domain: string; title: string | null; is_cited: boolean }[]
    run: { id: string; project_id: string; ran_at: Date; project: Project & { competitors: { name: string }[] } }
}): SaraDocument {
    const trackedCompetitorNames = new Set(chat.run.project.competitors.map(item => normalizeName(item.name)))
    const trackedMentions = chat.brand_mentions.filter(item => trackedCompetitorNames.has(normalizeName(item.brand_name)))
    const competitorMentions = trackedMentions.length
        ? trackedMentions.map(item => `${item.brand_name} position=${item.position ?? "n/a"} sentiment=${item.sentiment_score ?? "n/a"}`).join("; ")
        : "No tracked competitors detected in this answer."

    const sources = chat.sources.length
        ? chat.sources.map(item => `${item.domain}${item.title ? ` - ${item.title}` : ""}${item.is_cited ? " (cited)" : ""}`).join("; ")
        : "No sources detected."

    return {
        document_type: "chat_response",
        source_entity: "chat",
        source_entity_id: chat.id,
        title: `${chat.ai_model} response for ${chat.prompt.topic}`,
        text: [
            `Brand: ${chat.run.project.brand_name}`,
            `Model: ${chat.ai_model}`,
            `Run date: ${chat.run.ran_at.toISOString()}`,
            `Prompt: ${chat.prompt.text}`,
            `Brand mentioned: ${chat.brand_mentioned}`,
            `Brand position: ${chat.brand_position ?? "n/a"}`,
            `Sentiment score: ${chat.sentiment_score ?? "n/a"}`,
            `Tracked competitor mentions: ${competitorMentions}`,
            `Sources: ${sources}`,
            "",
            `AI response:`,
            chat.raw_response
        ].join("\n"),
        updated_at: chat.created_at,
        metadata: {
            chat_id: chat.id,
            prompt_id: chat.prompt_id,
            run_id: chat.run_id,
            engine: chat.ai_model,
            topic: chat.prompt.topic,
            brand_mentioned: chat.brand_mentioned,
            brand_position: chat.brand_position,
            sentiment_score: chat.sentiment_score,
            tracked_competitors: chat.run.project.competitors.map(item => item.name),
            mentioned_tracked_competitors: trackedMentions.map(item => item.brand_name),
            source_domains: [...new Set(chat.sources.map(item => item.domain))]
        }
    }
}

function buildSourceContentDocument(
    content: SourceUrlContent,
    project_id: string,
    project: { brand_name: string; competitors: { name: string }[] }
): SaraDocument {
    const body = content.content || content.snippet || ""
    const trackedBrands = new Set([project.brand_name, ...project.competitors.map(item => item.name)].map(normalizeName))
    const mentionedTrackedBrands = readStringArray(content.mentioned_brands)
        .filter(name => trackedBrands.has(normalizeName(name)))

    return {
        document_type: "source_content",
        source_entity: "source_url_content",
        source_entity_id: content.id,
        title: content.title ?? content.url,
        text: [
            `URL: ${content.url}`,
            `Domain: ${content.domain}`,
            `Title: ${content.title ?? "Untitled"}`,
            `Source type: ${content.source_type}`,
            `URL type: ${content.url_type}`,
            `Mentioned tracked brands: ${mentionedTrackedBrands.join(", ") || "None detected"}`,
            "",
            body
        ].join("\n"),
        updated_at: content.updated_at,
        metadata: {
            source_url_content_id: content.id,
            project_scope_id: project_id,
            url: content.url,
            domain: content.domain,
            source_type: content.source_type,
            url_type: content.url_type,
            platform: content.platform,
            subreddit: content.subreddit,
            fetch_status: content.fetch_status,
            mentioned_tracked_brands: mentionedTrackedBrands,
            tracked_competitors: project.competitors.map(item => item.name)
        }
    }
}

async function buildProjectSummaryDocument(project: Project & { competitors?: { name: string }[] }): Promise<SaraDocument> {
    const chats = await prisma.chat.findMany({
        where: { run: { project_id: project.id } },
        include: {
            brand_mentions: true,
            sources: true
        }
    })

    const totalChats = chats.length
    const brandHits = chats.filter(chat => chat.brand_mentioned)
    const visibility = totalChats ? (brandHits.length / totalChats) * 100 : null
    const avgPosition = brandHits.length
        ? brandHits.reduce((sum, chat) => sum + (chat.brand_position ?? 0), 0) / brandHits.length
        : null
    const avgSentiment = brandHits.length
        ? brandHits.reduce((sum, chat) => sum + (chat.sentiment_score ?? 0), 0) / brandHits.length
        : null

    const competitorMap = new Map<string, { count: number; totalPosition: number; totalSentiment: number }>()
    const sourceMap = new Map<string, { count: number; type: string }>()
    const trackedCompetitorNames = new Set((project.competitors ?? []).map(item => normalizeName(item.name)))

    for (const chat of chats) {
        for (const mention of chat.brand_mentions) {
            if (!trackedCompetitorNames.has(normalizeName(mention.brand_name))) continue
            const current = competitorMap.get(mention.brand_name) ?? { count: 0, totalPosition: 0, totalSentiment: 0 }
            competitorMap.set(mention.brand_name, {
                count: current.count + 1,
                totalPosition: current.totalPosition + (mention.position ?? 0),
                totalSentiment: current.totalSentiment + (mention.sentiment_score ?? 0)
            })
        }

        for (const domain of new Set(chat.sources.map(source => source.domain))) {
            const source = chat.sources.find(item => item.domain === domain)
            const current = sourceMap.get(domain) ?? { count: 0, type: source?.source_type ?? "OTHER" }
            sourceMap.set(domain, { count: current.count + 1, type: current.type })
        }
    }

    const topCompetitors = Array.from(competitorMap.entries())
        .map(([brand, stats]) => ({
            brand,
            visibility: totalChats ? (stats.count / totalChats) * 100 : 0,
            avg_position: stats.totalPosition / stats.count,
            avg_sentiment: stats.totalSentiment / stats.count
        }))
        .sort((a, b) => b.visibility - a.visibility)
        .slice(0, 8)
        .map(item => `${item.brand}: visibility ${round(item.visibility)}%, avg position ${round(item.avg_position)}, sentiment ${round(item.avg_sentiment)}`)
        .join("\n") || "No tracked competitor visibility data yet."

    const topSources = Array.from(sourceMap.entries())
        .map(([domain, stats]) => ({
            domain,
            usage_percentage: totalChats ? (stats.count / totalChats) * 100 : 0,
            source_type: stats.type
        }))
        .sort((a, b) => b.usage_percentage - a.usage_percentage)
        .slice(0, 10)
        .map(item => `${item.domain}: ${round(item.usage_percentage)}% usage, type ${item.source_type}`)
        .join("\n") || "No source data yet."

    return {
        document_type: "project_summary_snapshot",
        source_entity: "project_summary",
        source_entity_id: project.id,
        title: `${project.brand_name} visibility summary`,
        text: [
            `Brand: ${project.brand_name}`,
            `Current visibility: ${visibility === null ? "No data yet" : `${round(visibility)}%`}`,
            `Average position: ${avgPosition === null ? "No data yet" : round(avgPosition)}`,
            `Average sentiment: ${avgSentiment === null ? "No data yet" : round(avgSentiment)}`,
            "",
            "Tracked competitors:",
            (project.competitors ?? []).map(item => item.name).join(", ") || "No tracked competitors configured.",
            "",
            "Tracked competitor performance:",
            topCompetitors,
            "",
            "Top sources:",
            topSources
        ].join("\n"),
        updated_at: new Date(),
        metadata: {
            brand_name: project.brand_name,
            visibility,
            avg_position: avgPosition,
            avg_sentiment: avgSentiment,
            tracked_competitors: (project.competitors ?? []).map(item => item.name)
        }
    }
}

function chunkDocument(doc: SaraDocument) {
    if (doc.document_type !== "source_content" || doc.text.length <= SOURCE_CHUNK_CHARS) {
        return [doc.text]
    }

    const chunks: string[] = []
    let start = 0
    while (start < doc.text.length) {
        const end = Math.min(start + SOURCE_CHUNK_CHARS, doc.text.length)
        chunks.push(doc.text.slice(start, end).trim())
        if (end === doc.text.length) break
        start = Math.max(end - SOURCE_CHUNK_OVERLAP, start + 1)
    }

    return chunks.filter(Boolean)
}

function hashText(text: string) {
    return crypto.createHash("sha256").update(text).digest("hex")
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function normalizeName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function round(value: number | null) {
    return value === null ? "n/a" : Number(value.toFixed(2))
}

function clampLimit(value: number | undefined, fallback: number) {
    if (!Number.isFinite(value) || value === undefined) return fallback
    return Math.max(0, Math.min(Math.floor(value), fallback))
}

function isMissingCollectionError(error: unknown) {
    return typeof error === "object"
        && error !== null
        && "response" in error
        && (error as { response?: { status?: number } }).response?.status === 404
}
