import prisma from "../../../lib/prisma"
import { compactList, formatDate, type SaraContextSection } from "./context_format"

export type SaraProjectContext = {
    brand_name: string
    brand_url: string
    brand_location: string
    tracked_competitors: string[]
    section: SaraContextSection
}

export async function buildSaraProjectContext(project_id: string): Promise<SaraProjectContext> {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: project_id },
        include: {
            competitors: { orderBy: { created_at: "asc" } },
            prompts: {
                where: { status: { not: "DELETED" } },
                orderBy: { updated_at: "desc" },
                take: 12,
            },
        },
    })

    const activePrompts = project.prompts.filter(prompt => prompt.is_active && prompt.status === "ACTIVE")
    const trackedCompetitors = project.competitors.map(competitor => competitor.name)

    return {
        brand_name: project.brand_name,
        brand_url: project.brand_url,
        brand_location: project.brand_location,
        tracked_competitors: trackedCompetitors,
        section: {
            title: "Project Scope",
            lines: [
                `Brand: ${project.brand_name}`,
                `Website: ${project.brand_url}`,
                `Primary market: ${project.brand_location}`,
                `Tracked competitors only: ${trackedCompetitors.length ? compactList(trackedCompetitors, 12) : "none configured"}`,
                `Prompt pool: ${activePrompts.length} active prompt(s), ${project.prompts.length} recent configured prompt(s) shown in this packet`,
                activePrompts.length
                    ? `Recent active prompts: ${compactList(activePrompts.slice(0, 8).map(prompt => `${prompt.topic}: ${prompt.text}`), 8)}`
                    : "No active prompts are configured yet.",
                project.prompts[0]?.last_run_at ? `Most recent prompt run: ${formatDate(project.prompts[0].last_run_at)}` : null,
                "Guardrail: Treat only the configured tracked competitors above as competitors. Other discovered brands are evidence, not tracked competitors.",
            ],
        },
    }
}
