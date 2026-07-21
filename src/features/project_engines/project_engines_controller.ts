import { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { setProjectEngines } from "./project_engines_service"

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
