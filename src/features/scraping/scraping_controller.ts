import { Engine } from "@prisma/client"
import { Request, Response } from "express"
import { enqueueProjectRun, getScrapeRun } from "./scrape_orchestration_service"
import { assertProjectAccess } from "../projects/project_access"
import type { AuthenticatedRequest } from "../../middleware/auth"

export const enqueueProjectRunController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id, prompt_ids, engines, profile } = req.body

        if (!project_id) {
            res.status(400).json({ error: "project_id is required" })
            return
        }

        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)

        const parsedEngines = Array.isArray(engines)
            ? engines.map((engine: string) => engine.toUpperCase()).filter((engine: string) => engine in Engine) as Engine[]
            : undefined

        const result = await enqueueProjectRun({
            project_id,
            prompt_ids: Array.isArray(prompt_ids) ? prompt_ids : undefined,
            engines: parsedEngines,
            profile: typeof profile === "string" ? profile : undefined
        })

        res.status(202).json(result)
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Project not found" })
            return
        }
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to enqueue scrape run"
        })
    }
}

export const getScrapeRunController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { run_id } = req.params

        if (!run_id || Array.isArray(run_id)) {
            res.status(400).json({ error: "run_id is required" })
            return
        }

        const run = await getScrapeRun(run_id)

        if (!run) {
            res.status(404).json({ error: "Run not found" })
            return
        }

        await assertProjectAccess(run.project_id, (req as AuthenticatedRequest).user.id)

        res.status(200).json(run)
    } catch (error) {
        if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
            res.status(404).json({ error: "Run not found" })
            return
        }
        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to get scrape run"
        })
    }
}
