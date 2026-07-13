import { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { assertProjectAccess } from "../projects/project_access"
import { getOpportunities } from "./opportunity_service"
import type { DashboardFilters } from "../dashboard/dashboard_service"

function parseFilters(query: Request["query"]): DashboardFilters {
    const filters: DashboardFilters = {}
    if (query.days) filters.days = parseInt(query.days as string, 10)
    if (query.model && query.model !== "all") filters.model = query.model as string
    if (query.topic && query.topic !== "all") filters.topic = query.topic as string
    if (query.prompt_id && query.prompt_id !== "all") filters.prompt_id = query.prompt_id as string
    if (query.q) filters.q = query.q as string
    return filters
}

export async function getOpportunitiesController(req: Request, res: Response): Promise<void> {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
        const data = await getOpportunities(project_id, parseFilters(req.query))
        res.status(200).json(data)
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }
        res.status(500).json({ error: "Failed to get opportunities" })
    }
}
