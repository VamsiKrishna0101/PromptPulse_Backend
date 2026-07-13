import { randomUUID } from "crypto"
import prisma from "../../lib/prisma"
import type { GeoArticleResponse } from "./geoarticle_types"

export type SavedContentBrief = {
    id: string
    project_id: string
    user_id: string
    status: GeoArticleResponse["status"]
    title: string
    slug: string | null
    topic: string | null
    target_prompt_id: string | null
    target_prompt_text: string
    content_type: string | null
    action: string | null
    opportunity_offset: number
    brief: GeoArticleResponse["brief"]
    article: GeoArticleResponse["article"]
    prompt_used: GeoArticleResponse["prompt_used"] | null
    generation_error: string | null
    created_at: Date
    updated_at: Date
}

function json(value: unknown) {
    return JSON.stringify(value ?? null)
}

export async function upsertSavedContentBrief(input: {
    project_id: string
    user_id: string
    response: GeoArticleResponse
}): Promise<SavedContentBrief> {
    const { project_id, user_id, response } = input
    const brief = response.brief
    const article = response.article
    const id = randomUUID()
    const title = article?.title ?? brief.recommended_article.title
    const slug = article?.slug ?? brief.recommended_article.suggested_slug ?? null
    const offset = response.current_offset ?? 0

    const rows = await prisma.$queryRaw<SavedContentBrief[]>`
        INSERT INTO "ContentBrief" (
            id, project_id, user_id, status, title, slug, topic,
            target_prompt_id, target_prompt_text, content_type, action,
            opportunity_offset, brief, article, prompt_used, generation_error, updated_at
        )
        VALUES (
            ${id}, ${project_id}, ${user_id}, ${response.status}, ${title}, ${slug}, ${brief.topic ?? null},
            ${brief.target_prompt.id ?? null}, ${brief.target_prompt.text}, ${brief.recommended_article.content_type ?? null},
            ${brief.recommended_article.action ?? null}, ${offset},
            ${json(brief)}::jsonb, ${json(article)}::jsonb, ${json(response.prompt_used)}::jsonb,
            ${response.generation_error ?? null}, NOW()
        )
        ON CONFLICT (project_id, user_id, target_prompt_id, opportunity_offset)
        DO UPDATE SET
            status = EXCLUDED.status,
            title = EXCLUDED.title,
            slug = EXCLUDED.slug,
            topic = EXCLUDED.topic,
            target_prompt_text = EXCLUDED.target_prompt_text,
            content_type = EXCLUDED.content_type,
            action = EXCLUDED.action,
            brief = EXCLUDED.brief,
            article = EXCLUDED.article,
            prompt_used = EXCLUDED.prompt_used,
            generation_error = EXCLUDED.generation_error,
            updated_at = NOW()
        RETURNING *
    `

    return rows[0]
}

export async function listSavedContentBriefs(input: {
    project_id: string
    user_id: string
    topic?: string
    limit?: number
}): Promise<SavedContentBrief[]> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100)

    if (input.topic) {
        return prisma.$queryRaw<SavedContentBrief[]>`
            SELECT *
            FROM "ContentBrief"
            WHERE project_id = ${input.project_id}
              AND user_id = ${input.user_id}
              AND topic = ${input.topic}
            ORDER BY updated_at DESC
            LIMIT ${limit}
        `
    }

    return prisma.$queryRaw<SavedContentBrief[]>`
        SELECT *
        FROM "ContentBrief"
        WHERE project_id = ${input.project_id}
          AND user_id = ${input.user_id}
        ORDER BY updated_at DESC
        LIMIT ${limit}
    `
}

export async function getSavedContentBrief(input: {
    id: string
    project_id: string
    user_id: string
}): Promise<SavedContentBrief | null> {
    const rows = await prisma.$queryRaw<SavedContentBrief[]>`
        SELECT *
        FROM "ContentBrief"
        WHERE id = ${input.id}
          AND project_id = ${input.project_id}
          AND user_id = ${input.user_id}
        LIMIT 1
    `

    return rows[0] ?? null
}

export async function deleteSavedContentBrief(input: {
    id: string
    project_id: string
    user_id: string
}): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
        DELETE FROM "ContentBrief"
        WHERE id = ${input.id}
          AND project_id = ${input.project_id}
          AND user_id = ${input.user_id}
        RETURNING id
    `

    return rows.length > 0
}
