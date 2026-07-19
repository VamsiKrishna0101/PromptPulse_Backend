import type { Request, Response } from "express"
import { Plan } from "@prisma/client"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { assertProjectAccess } from "../projects/project_access"
import { getEffectivePlanAccess } from "../subscription/entitlements"
import { retryFailedJobsForRun } from "./scrape_retry_service"
import prisma from "../../lib/prisma"

export async function retryFailedJobsController(req: Request, res: Response): Promise<void> {
    try {
        const runId = req.params.run_id
        if (!runId || Array.isArray(runId)) {
            res.status(400).json({ error: "run_id is required" })
            return
        }

        const run = await prisma.run.findUnique({
            where: { id: runId },
            select: { project_id: true },
        })
        if (!run) {
            res.status(404).json({ error: "Run not found" })
            return
        }

        const userId = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(run.project_id, userId)
        const access = await getEffectivePlanAccess(userId)
        if (access.effective_plan === Plan.FREE) {
            res.status(403).json({ error: "Your trial has ended. Upgrade to retry failed scraping jobs." })
            return
        }
        const result = await retryFailedJobsForRun(runId)

        if (result.queued === 0) {
            res.status(409).json({
                error: result.exhausted > 0
                    ? "These failed jobs have already used both retry attempts."
                    : "There are no failed jobs eligible for retry.",
                ...result,
            })
            return
        }

        res.status(202).json(result)
    } catch (error) {
        if (error instanceof Error && (error.message === "PROJECT_NOT_FOUND" || error.message === "RUN_NOT_FOUND")) {
            res.status(404).json({ error: "Run not found" })
            return
        }

        res.status(500).json({
            error: error instanceof Error ? error.message : "Failed to retry scrape jobs",
        })
    }
}
