import prisma from "../../lib/prisma"
import {
    ACTION_QUEUE_STATUSES,
    type ActionQueueStatus,
} from "./action_queue_types"

type ListActionQueueParams = {
    projectId: string
    userId: string
    status?: string
    category?: string
}

export async function listActionQueueItems({
    projectId,
    userId,
    status,
    category,
}: ListActionQueueParams) {
    const items = await prisma.actionQueueItem.findMany({
        where: {
            project_id: projectId,
            user_id: userId,
            ...(isKnownStatus(status) ? { status } : {}),
            ...(category ? { category: category.toUpperCase() } : {}),
        },
        orderBy: [
            { impact_score: "desc" },
            { updated_at: "desc" },
        ],
    })

    return items.sort((a, b) => {
        const statusDelta = statusRank(a.status) - statusRank(b.status)
        if (statusDelta !== 0) return statusDelta
        const priorityDelta = priorityRank(a.priority) - priorityRank(b.priority)
        if (priorityDelta !== 0) return priorityDelta
        return b.impact_score - a.impact_score
    })
}

export async function updateActionQueueItemStatus({
    itemId,
    userId,
    status,
}: {
    itemId: string
    userId: string
    status: ActionQueueStatus
}) {
    const existing = await prisma.actionQueueItem.findFirst({
        where: { id: itemId, user_id: userId },
        select: { id: true },
    })

    if (!existing) {
        throw new Error("ACTION_QUEUE_ITEM_NOT_FOUND")
    }

    return prisma.actionQueueItem.update({
        where: { id: itemId },
        data: {
            status,
            completed_at: status === "DONE" ? new Date() : null,
        },
    })
}

export function normalizeActionStatus(value: unknown): ActionQueueStatus | null {
    if (typeof value !== "string") return null
    const normalized = value.trim().toUpperCase()
    return isKnownStatus(normalized) ? normalized : null
}

function isKnownStatus(value: unknown): value is ActionQueueStatus {
    return typeof value === "string" && ACTION_QUEUE_STATUSES.includes(value as ActionQueueStatus)
}

function statusRank(status: string) {
    const rank = ["OPEN", "IN_PROGRESS", "DONE", "DISMISSED"].indexOf(status)
    return rank === -1 ? 99 : rank
}

function priorityRank(priority: string) {
    const rank = ["HIGH", "MEDIUM", "LOW"].indexOf(priority)
    return rank === -1 ? 99 : rank
}
