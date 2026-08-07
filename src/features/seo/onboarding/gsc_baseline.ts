import prisma from "../../../lib/prisma"

export type GscBaseline = {
    connected: boolean
    selected_site_url: string | null
    last_synced_at: string | null
    totals: { clicks: number; impressions: number; ctr: number; average_position: number }
    quick_wins: Array<{ query: string; page: string; impressions: number; clicks: number; ctr: number; position: number }>
    low_ctr: Array<{ query: string; page: string; impressions: number; clicks: number; ctr: number; position: number }>
}

export async function getGscBaseline(projectId: string): Promise<GscBaseline> {
    const connection = await prisma.gscConnection.findFirst({
        where: { project_id: projectId, disconnected_at: null },
        orderBy: { updated_at: "desc" },
        select: { selected_site_url: true, last_synced_at: true, id: true },
    })
    if (!connection) return {
        connected: false, selected_site_url: null, last_synced_at: null,
        totals: { clicks: 0, impressions: 0, ctr: 0, average_position: 0 }, quick_wins: [], low_ctr: [],
    }

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const rows = await prisma.gscDataRow.findMany({
        where: { project_id: projectId, connection_id: connection.id, date: { gte: since } },
        select: { query: true, page: true, clicks: true, impressions: true, ctr: true, position: true },
        take: 20_000,
    })
    const grouped = new Map<string, { query: string; page: string; clicks: number; impressions: number; weightedPosition: number }>()
    for (const row of rows) {
        const key = `${row.query}\u0000${row.page}`
        const value = grouped.get(key) ?? { query: row.query, page: row.page, clicks: 0, impressions: 0, weightedPosition: 0 }
        value.clicks += row.clicks
        value.impressions += row.impressions
        value.weightedPosition += row.position * row.impressions
        grouped.set(key, value)
    }
    const values = [...grouped.values()].map(row => ({
        ...row,
        ctr: row.impressions ? row.clicks / row.impressions : 0,
        position: row.impressions ? row.weightedPosition / row.impressions : 0,
    }))
    const impressions = values.reduce((sum, row) => sum + row.impressions, 0)
    const clicks = values.reduce((sum, row) => sum + row.clicks, 0)
    const quick_wins = values.filter(row => row.impressions >= 50 && row.position >= 8 && row.position <= 30)
        .sort((a, b) => b.impressions - a.impressions).slice(0, 20)
    const low_ctr = values.filter(row => row.impressions >= 100 && row.position <= 10 && row.ctr < 0.03)
        .sort((a, b) => b.impressions - a.impressions).slice(0, 20)
    return {
        connected: true,
        selected_site_url: connection.selected_site_url,
        last_synced_at: connection.last_synced_at?.toISOString() ?? null,
        totals: {
            clicks, impressions, ctr: impressions ? clicks / impressions : 0,
            average_position: impressions ? values.reduce((sum, row) => sum + row.weightedPosition, 0) / impressions : 0,
        },
        quick_wins, low_ctr,
    }
}
