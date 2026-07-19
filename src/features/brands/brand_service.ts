import prisma from "../../lib/prisma"
import type { AddCompetitorInput } from "./brand_types"
import { buildChatWhere, type DashboardFilters } from "../dashboard/dashboard_service"
import { assertCanAddCompetitor } from "../subscription/subscription_service"
import { sameBrandEntity, sanitizeDiscoveredBrandName } from "./brand_entity_policy"

type ChatWithMentions = Awaited<ReturnType<typeof loadBrandChats>>[number]

function previousPeriodDateWhere(filters: DashboardFilters) {
    if (!filters.days) return undefined

    const now = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    return {
        gte: new Date(now - filters.days * 2 * dayMs),
        lt: new Date(now - filters.days * dayMs)
    }
}

function splitAllTimeChats<T extends { created_at: Date }>(chats: T[]) {
    const sorted = [...chats].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    const midpoint = Math.floor(sorted.length / 2)
    return {
        previous: sorted.slice(0, midpoint),
        current: sorted.slice(midpoint)
    }
}

function deltaValue(current: number | null, previous: number | null, lowerIsBetter = false) {
    if (current === null || previous === null) return null
    const diff = current - previous
    return lowerIsBetter ? -diff : diff
}

async function loadBrandChats(project_id: string, filters?: DashboardFilters) {
    return prisma.chat.findMany({
        where: buildChatWhere(project_id, filters || {}),
        include: { brand_mentions: true }
    })
}

async function loadPreviousBrandChats(project_id: string, filters?: DashboardFilters, currentChats: ChatWithMentions[] = []) {
    if (filters?.days) {
        const previousWhere = buildChatWhere(project_id, { ...filters, days: undefined })
        previousWhere.created_at = previousPeriodDateWhere(filters)
        return prisma.chat.findMany({
            where: previousWhere,
            include: { brand_mentions: true }
        })
    }

    return splitAllTimeChats(currentChats).previous
}

function aggregateBrandMap(chats: ChatWithMentions[]) {
    const totalChats = chats.length
    const brandMap = new Map<string, { name: string, count: number, totalPosition: number, totalSentiment: number, sentimentCount: number }>()

    for (const chat of chats) {
        const seenInChat = new Set<string>()
        for (const mention of chat.brand_mentions) {
            const name = sanitizeDiscoveredBrandName(mention.brand_name)
            if (!name) continue
            const key = name.toLowerCase()
            if (seenInChat.has(key)) continue
            seenInChat.add(key)
            const existing = brandMap.get(key) || { name, count: 0, totalPosition: 0, totalSentiment: 0, sentimentCount: 0 }
            brandMap.set(key, {
                name: existing.name,
                count: existing.count + 1,
                totalPosition: existing.totalPosition + (mention.position ?? 0),
                totalSentiment: existing.totalSentiment + (mention.sentiment_score ?? 0),
                sentimentCount: existing.sentimentCount + (mention.sentiment_score !== null ? 1 : 0)
            })
        }
    }

    return { totalChats, brandMap }
}

function mentionsForBrand(name: string, chats: ChatWithMentions[]) {
    return chats.flatMap(chat => {
        const matches = chat.brand_mentions.filter(mention => sameBrandEntity(mention.brand_name, name))
        if (matches.length === 0) return []

        return [matches.reduce((best, mention) => {
            if (best.position === null) return mention
            if (mention.position === null) return best
            return mention.position < best.position ? mention : best
        })]
    })
}

function brandStats(name: string, chats: ChatWithMentions[]) {
    const totalChats = chats.length
    const mentions = mentionsForBrand(name, chats)
    const sentimentMentions = mentions.filter(m => m.sentiment_score !== null)

    return {
        visibility: totalChats > 0 ? (mentions.length / totalChats) * 100 : 0,
        avg_position: mentions.length > 0 ? mentions.reduce((acc, m) => acc + (m.position ?? 0), 0) / mentions.length : null,
        avg_sentiment: sentimentMentions.length > 0 ? sentimentMentions.reduce((acc, m) => acc + (m.sentiment_score ?? 0), 0) / sentimentMentions.length : null,
        mention_count: mentions.length
    }
}

function attachDeltas<T extends { visibility: number; avg_position: number | null; avg_sentiment: number | null }>(
    row: T,
    previous: { visibility: number; avg_position: number | null; avg_sentiment: number | null } | null
) {
    return {
        ...row,
        delta_visibility: deltaValue(row.visibility, previous?.visibility ?? null),
        delta_position: deltaValue(row.avg_position, previous?.avg_position ?? null, true),
        delta_sentiment: deltaValue(row.avg_sentiment, previous?.avg_sentiment ?? null)
    }
}

export async function getDiscoveredBrands(project_id: string, filters?: DashboardFilters) {
    const chats = await loadBrandChats(project_id, filters)

    const totalChats = chats.length
    if (totalChats === 0) return []

    const { brandMap } = aggregateBrandMap(chats)
    const previousChats = await loadPreviousBrandChats(project_id, filters, chats)

    return Array.from(brandMap.values()).map(data => ({
        brand_name: data.name,
        visibility: (data.count / totalChats) * 100,
        avg_position: data.count > 0 ? data.totalPosition / data.count : null,
        avg_sentiment: data.sentimentCount > 0 ? data.totalSentiment / data.sentimentCount : null,
        mention_count: data.count
    })).map(row => attachDeltas(row, brandStats(row.brand_name, previousChats))).sort((a, b) => b.visibility - a.visibility)
}

export async function addCompetitor(input: AddCompetitorInput & { user_id: string }) {
    const { project_id, name, url, user_id } = input

    const existing = await prisma.competitor.findFirst({
        where: { project_id, name }
    })

    if (existing) {
        if (url && existing.url !== url) {
            return prisma.competitor.update({ where: { id: existing.id }, data: { url } })
        }
        return existing
    }

    await assertCanAddCompetitor(user_id)

    return prisma.competitor.create({
        data: { project_id, name, url }
    })
}

export async function getTrackedCompetitors(project_id: string, filters?: DashboardFilters) {
    const chats = await loadBrandChats(project_id, filters)

    const totalChats = chats.length
    const previousChats = await loadPreviousBrandChats(project_id, filters, chats)

    const tracked = await prisma.competitor.findMany({
        where: { project_id }
    })

    return tracked.map(competitor => {
        const allMentions = mentionsForBrand(competitor.name, chats)

        const mentionCount = allMentions.length
        const sentimentMentions = allMentions.filter(m => m.sentiment_score !== null)

        const current = {
            id: competitor.id,
            name: competitor.name,
            url: competitor.url,
            visibility: totalChats > 0 ? (mentionCount / totalChats) * 100 : 0,
            avg_position: mentionCount > 0 ? allMentions.reduce((acc, m) => acc + (m.position ?? 0), 0) / mentionCount : null,
            avg_sentiment: sentimentMentions.length > 0 ? sentimentMentions.reduce((acc, m) => acc + (m.sentiment_score ?? 0), 0) / sentimentMentions.length : null,
            mention_count: mentionCount
        }
        return attachDeltas(current, brandStats(competitor.name, previousChats))
    }).sort((a, b) => b.visibility - a.visibility)
}

export async function removeCompetitor(competitor_id: string) {
    return prisma.competitor.delete({
        where: { id: competitor_id }
    })
}
