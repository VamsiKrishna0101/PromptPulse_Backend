export const ACTION_QUEUE_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "DISMISSED"] as const
export type ActionQueueStatus = typeof ACTION_QUEUE_STATUSES[number]

export const ACTION_QUEUE_CATEGORIES = [
    "CONTENT",
    "SOURCE",
    "PROMPT",
    "COMPETITOR",
    "MODEL",
    "TECHNICAL",
    "REPORT",
] as const
export type ActionQueueCategory = typeof ACTION_QUEUE_CATEGORIES[number]

export const ACTION_QUEUE_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const
export type ActionQueuePriority = typeof ACTION_QUEUE_PRIORITIES[number]
