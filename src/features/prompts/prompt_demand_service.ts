import prisma from "../../lib/prisma"

export type ObservedPromptDemand = {
    runs_30d: number
    score: number | null
    label: "HIGH" | "MODERATE" | "LOW" | "NOT_ENOUGH_DATA"
}

const DEMAND_WINDOW_DAYS = 30

function demandLabel(score: number | null): ObservedPromptDemand["label"] {
    if (score === null) return "NOT_ENOUGH_DATA"
    if (score >= 67) return "HIGH"
    if (score >= 34) return "MODERATE"
    return "LOW"
}

/**
 * Measures observed AI demand inside PromptPulse, not Google search volume.
 * A prompt earns a signal only from completed chat records in the last 30 days.
 */
export async function getObservedPromptDemand(promptIds: string[]) {
    if (!promptIds.length) return new Map<string, ObservedPromptDemand>()

    const since = new Date(Date.now() - DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const rows = await prisma.chat.groupBy({
        by: ["prompt_id"],
        where: {
            prompt_id: { in: promptIds },
            created_at: { gte: since },
        },
        _count: { _all: true },
    })

    const counts = new Map(rows.map(row => [row.prompt_id, row._count._all]))
    const maxRuns = Math.max(0, ...counts.values())
    const demand = new Map<string, ObservedPromptDemand>()

    for (const promptId of promptIds) {
        const runs = counts.get(promptId) ?? 0
        // Log scaling keeps one very active prompt from flattening every other prompt.
        const score = maxRuns > 0 && runs > 0
            ? Math.round((Math.log1p(runs) / Math.log1p(maxRuns)) * 100)
            : null
        demand.set(promptId, {
            runs_30d: runs,
            score,
            label: demandLabel(score),
        })
    }

    return demand
}
