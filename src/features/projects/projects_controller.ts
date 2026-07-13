import { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { getUserProjects } from "./projects_service"

export const getUserProjectsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const user_id = (req as AuthenticatedRequest).user.id
        const projects = await getUserProjects(user_id)
        res.status(200).json(projects)
    } catch {
        res.status(500).json({ error: "Failed to retrieve projects" })
    }
}
