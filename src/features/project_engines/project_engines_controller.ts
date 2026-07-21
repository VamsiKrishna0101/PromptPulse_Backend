import { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { getProjectEngines, setProjectEngines } from "./project_engines_service"
import { assertProjectAccess } from "../projects/project_access"
import { SELECTABLE_PROJECT_ENGINES, getEngineLimitForPlan } from "./project_engine_policy"
import { getUserPlan } from "../subscription/subscription_service"

export async function getProjectEnginesController(req: Request, res: Response): Promise<void> {
    try {
        const projectId = req.params.project_id
        const userId = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(projectId, userId)
        const plan = await getUserPlan(userId)
        const engines = await getProjectEngines(projectId)
        const limit = getEngineLimitForPlan(plan)
        res.status(200).json({
            engines,
            selectable: [...SELECTABLE_PROJECT_ENGINES],
            limit,
            plan,
        })
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }
        const message = error instanceof Error ? error.message : "Failed to load AI engines"
        res.status(500).json({ error: message })
    }
}

export async function updateProjectEnginesController(req: Request, res: Response): Promise<void> {
    try {
        const projectId = req.params.project_id
        const userId = (req as AuthenticatedRequest).user.id
        const engines = await setProjectEngines(projectId, userId, req.body.engines)
        res.status(200).json({ engines })
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }

        const message = error instanceof Error ? error.message : "Failed to update AI engines"
        res.status(message.includes("Select") || message.includes("plan") ? 400 : 500).json({ error: message })
    }
}
