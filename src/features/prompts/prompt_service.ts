import prisma from '../../lib/prisma'
export { GEO_COUNTRIES } from '../geo/countries'

// ─── Geo: supported countries (top GEO markets) ───────────────────────────────

export type PromptStatus = 'ACTIVE' | 'SUGGESTED' | 'INACTIVE' | 'ARCHIVED' | 'DELETED'

export interface GetPromptsInput {
    project_id: string
    status?: PromptStatus
    topic?: string
    model?: string
    days?: number
    country?: string
    intent?: string
    tag?: string
    mentioned?: boolean
    cited?: boolean
}

export type TopicInput = {
    name: string
    project_id: string,

}

export type CreatePromptInput = {
    text: string
    topic: string
    project_id: string
}

export type PromptTopic = {
    id: string
    name: string
    created_at: Date
    updated_at: Date
}

export async function getPromptsWithStats(input: GetPromptsInput) {
    const { project_id, status, topic, model, days, country, intent, tag, mentioned, cited } = input

    const promptWhere: any = { project_id }
    if (status) promptWhere.status = status
    if (topic) promptWhere.topic = topic
    if (intent) promptWhere.type = intent
    if (tag) promptWhere.tags = { has: tag }

    const prompts = await prisma.prompt.findMany({
        where: promptWhere,
        include: {
            chats: {
                where: {
                    ...(days ? { created_at: { gte: new Date(Date.now() - days * 86400000) } } : {}),
                    ...(model ? { ai_model: { contains: model, mode: 'insensitive' } } : {}),
                    ...(country ? { OR: [{ geo_country_code: country }, { geo_country_name: { equals: country, mode: 'insensitive' } }] } : {}),
                    ...(typeof mentioned === 'boolean' ? { brand_mentioned: mentioned } : {}),
                    ...(cited === true ? { sources: { some: { is_cited: true } } } : {}),
                    ...(cited === false ? { sources: { none: { is_cited: true } } } : {}),
                },
                select: {
                    ai_model: true,
                    brand_mentioned: true,
                    brand_position: true,
                    sentiment_score: true,
                    brand_mentions: {
                        select: {
                            brand_name: true,
                        },
                    },
                }
            }
        },
        orderBy: { created_at: 'desc' }
    })

    return prompts.map(prompt => {
        const chats = prompt.chats
        const total = chats.length

        // Visibility = % of chats where brand was mentioned
        const mentioned = chats.filter(c => c.brand_mentioned).length
        const visibility = total > 0 ? (mentioned / total) * 100 : null

        // Sentiment = average sentiment_score across chats that have it
        const sentimentChats = chats.filter(c => c.sentiment_score !== null)
        const avg_sentiment = sentimentChats.length > 0
            ? sentimentChats.reduce((acc, c) => acc + (c.sentiment_score ?? 0), 0) / sentimentChats.length
            : null

        // Position = average brand_position across chats where brand appeared
        const positionChats = chats.filter(c => c.brand_mentioned && c.brand_position !== null)
        const avg_position = positionChats.length > 0
            ? positionChats.reduce((acc, c) => acc + (c.brand_position ?? 0), 0) / positionChats.length
            : null

        // Mentions = collect all brand names mentioned in chats
        const mentionSet = new Map<string, number>()
        for (const chat of chats) {
            for (const mention of chat.brand_mentions) {
                mentionSet.set(mention.brand_name, (mentionSet.get(mention.brand_name) ?? 0) + 1)
            }
        }
        const mentions = Array.from(mentionSet.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name)

        // AI models used
        const models = [...new Set(chats.map(c => c.ai_model))]

        return {
            id: prompt.id,
            text: prompt.text,
            topic: prompt.topic,
            type: prompt.type,
            tags: prompt.tags || [],
            status: prompt.status,
            source: prompt.source,
            priority_score: prompt.priority_score,
            volume_score: prompt.volume_score,
            last_run_at: prompt.last_run_at,
            created_at: prompt.created_at,
            // stats
            total_chats: total,
            visibility,
            avg_sentiment,
            avg_position,
            mentions,
            models,
        }
    })
}

export async function activatePrompt(prompt_id: string) {
    return prisma.prompt.update({
        where: { id: prompt_id },
        data: { status: 'ACTIVE', is_active: true }
    })
}

export async function deactivatePrompt(prompt_id: string) {
    return prisma.prompt.update({
        where: { id: prompt_id },
        data: { status: 'INACTIVE', is_active: false }
    })
}

export async function getPromptTopics(project_id: string) {
    const [savedTopics, prompts] = await Promise.all([
        prisma.topic.findMany({
            where: { project_id },
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                created_at: true,
                updated_at: true,
            },
        }),
        prisma.prompt.findMany({
            where: { project_id },
            select: { topic: true }
        }),
    ])

    const savedNames = new Set(savedTopics.map(topic => topic.name.toLowerCase()))
    const promptOnlyTopics = [...new Set(prompts.map(p => p.topic.trim()).filter(Boolean))]
        .filter(name => !savedNames.has(name.toLowerCase()))
        .map(name => ({
            id: `prompt-topic:${name}`,
            name,
            created_at: new Date(0),
            updated_at: new Date(0),
        }))

    return [...savedTopics, ...promptOnlyTopics].sort((a, b) => a.name.localeCompare(b.name))
}

export async function getPromptStats(project_id: string) {
    const counts = await prisma.prompt.groupBy({
        by: ['status'],
        where: { project_id },
        _count: { _all: true }
    })
    const total = await prisma.prompt.count({ where: { project_id } })
    const byStatus: Record<string, number> = {}
    for (const row of counts) {
        byStatus[row.status] = row._count._all
    }
    return { total, byStatus }
}

export async function createTopic(input: TopicInput) {
    const { name, project_id } = input
    const normalizedName = name.trim().replace(/\s+/g, ' ')

    return prisma.topic.upsert({
        where: {
            project_id_name: {
                project_id,
                name: normalizedName,
            },
        },
        create: {
            name: normalizedName,
            project_id,
        },
        update: {},
        select: {
            id: true,
            name: true,
            created_at: true,
            updated_at: true,
        },
    })
}

export async function createPrompt(input: CreatePromptInput) {
    const normalizedText = input.text.trim().replace(/\s+/g, ' ')
    const normalizedTopic = input.topic.trim().replace(/\s+/g, ' ')

    return prisma.prompt.create({
        data: {
            text: normalizedText,
            topic: normalizedTopic,
            type: 'customer_prompt',
            project_id: input.project_id,
            status: 'ACTIVE',
            source: 'CUSTOMER',
        },
        select: {
            id: true,
            text: true,
            topic: true,
            type: true,
            tags: true,
            status: true,
            source: true,
            priority_score: true,
            volume_score: true,
            last_run_at: true,
            created_at: true,
        },
    })
}

// ─── Geo Variant types ────────────────────────────────────────────────────────

export interface AddGeoVariantInput {
    prompt_id: string
    country_code: string
    country_name: string
    city?: string
}

export interface GeoVisibilityRow {
    country_code: string
    country_name: string
    city: string | null
    visibility: number | null
    avg_sentiment: number | null
    avg_position: number | null
    chat_count: number
}

// ─── Geo: wrap a prompt with location persona context ─────────────────────────
// This is how all GEO platforms do it — prepend location so AI answers locally

export function buildGeoPromptText(
    basePrompt: string,
    countryName: string,
    city?: string | null
): string {
    const location = city ? `${city}, ${countryName}` : countryName
    return `[Location context: ${location}] ${basePrompt}`
}

// ─── Geo Variant CRUD ─────────────────────────────────────────────────────────

export async function getGeoVariantsForPrompt(prompt_id: string) {
    return prisma.geoPromptVariant.findMany({
        where: { prompt_id },
        orderBy: [{ country_code: 'asc' }, { city: 'asc' }],
    })
}

export async function addGeoVariant(input: AddGeoVariantInput) {
    const { prompt_id, country_code, country_name, city } = input
    const normalizedCity = city?.trim() || ""

    // Enable geo on the prompt if not already
    await prisma.prompt.update({
        where: { id: prompt_id },
        data: { geo_enabled: true },
    })

    return prisma.geoPromptVariant.upsert({
        where: {
            prompt_id_country_code_city: {
                prompt_id,
                country_code: country_code.toUpperCase(),
                city: normalizedCity,
            },
        },
        create: {
            prompt_id,
            country_code: country_code.toUpperCase(),
            country_name,
            city: normalizedCity,
            is_active: true,
        },
        update: { is_active: true, country_name },
    })
}

export async function removeGeoVariant(variant_id: string) {
    return prisma.geoPromptVariant.delete({ where: { id: variant_id } })
}

export async function toggleGeoVariant(variant_id: string, is_active: boolean) {
    return prisma.geoPromptVariant.update({
        where: { id: variant_id },
        data: { is_active },
    })
}

// ─── Geo Visibility Stats ─────────────────────────────────────────────────────

export async function getGeoVisibilityStats(
    project_id: string,
    days?: number
): Promise<GeoVisibilityRow[]> {
    const dateFilter = days
        ? { created_at: { gte: new Date(Date.now() - days * 86_400_000) } }
        : {}

    const chats = await prisma.chat.findMany({
        where: {
            run: { project_id },
            geo_country_code: { not: null },
            ...dateFilter,
        },
        select: {
            geo_country_code: true,
            geo_country_name: true,
            geo_city: true,
            brand_mentioned: true,
            sentiment_score: true,
            brand_position: true,
        },
    })

    // Group by country_code + city
    const grouped = new Map<string, typeof chats>()
    for (const chat of chats) {
        const key = `${chat.geo_country_code}::${chat.geo_city ?? ''}`
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(chat)
    }

    const rows: GeoVisibilityRow[] = []
    for (const [, group] of grouped) {
        const first = group[0]
        const total = group.length
        const mentioned = group.filter(c => c.brand_mentioned).length
        const sentimentChats = group.filter(c => c.sentiment_score !== null)
        const positionChats = group.filter(c => c.brand_mentioned && c.brand_position !== null)

        rows.push({
            country_code: first.geo_country_code!,
            country_name: first.geo_country_name ?? first.geo_country_code!,
            city: first.geo_city,
            visibility: total > 0 ? Math.round((mentioned / total) * 100) : null,
            avg_sentiment: sentimentChats.length > 0
                ? sentimentChats.reduce((acc, c) => acc + (c.sentiment_score ?? 0), 0) / sentimentChats.length
                : null,
            avg_position: positionChats.length > 0
                ? positionChats.reduce((acc, c) => acc + (c.brand_position ?? 0), 0) / positionChats.length
                : null,
            chat_count: total,
        })
    }

    return rows.sort((a, b) => (b.visibility ?? 0) - (a.visibility ?? 0))
}
