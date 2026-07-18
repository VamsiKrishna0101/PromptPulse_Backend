import prisma from "../../../lib/prisma"
import { formatDate, type SaraContextSection } from "./context_format"

export async function buildSaraActionContext(project_id: string, user_id: string): Promise<SaraContextSection> {
    const [actions, briefs, reports] = await Promise.all([
        prisma.actionQueueItem.findMany({
            where: { project_id, user_id },
            orderBy: [
                { impact_score: "desc" },
                { updated_at: "desc" },
            ],
            take: 8,
        }),
        prisma.contentBrief.findMany({
            where: { project_id, user_id },
            orderBy: { updated_at: "desc" },
            take: 5,
            select: {
                title: true,
                status: true,
                target_prompt_text: true,
                updated_at: true,
            },
        }),
        prisma.aIReport.findMany({
            where: { project_id, user_id },
            orderBy: { created_at: "desc" },
            take: 3,
            select: {
                period_type: true,
                status: true,
                created_at: true,
            },
        }),
    ])

    const openActions = actions.filter(action => action.status !== "DONE" && action.status !== "DISMISSED")
    const priorityActions = openActions.slice(0, 5).map(action =>
        `${action.priority} ${action.category}: ${action.title} (impact ${action.impact_score}, effort ${action.effort_score})`
    )

    return {
        title: "Execution Workspace",
        lines: [
            `Action queue: ${openActions.length} open item(s), ${actions.filter(action => action.status === "DONE").length} done in recent items`,
            priorityActions.length ? `Priority actions: ${priorityActions.join(" | ")}` : "No open action queue items found.",
            briefs.length ? `Recent content briefs: ${briefs.map(brief => `${brief.title} (${brief.status}, updated ${formatDate(brief.updated_at)})`).join(" | ")}` : "No saved content briefs yet.",
            reports.length ? `Recent reports: ${reports.map(report => `${report.period_type} ${report.status} at ${formatDate(report.created_at)}`).join(" | ")}` : "No AI reports generated yet.",
        ],
    }
}
