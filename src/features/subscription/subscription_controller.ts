import type { Request, Response } from "express"
import { Plan } from "@prisma/client"
import type { AuthenticatedRequest } from "../../middleware/auth"
import {
    canAddCompetitor,
    canCreateProject,
    canCreatePrompt,
    canExport,
    canRunRefresh,
    canUseSara,
    createSubscription,
    getMyPlan,
    getPlanLimits,
    getPlanQuota,
    handleStripeWebhook,
    refreshPlanUsage,
} from "./subscription_service"

export async function createSubscriptionController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const { plan } = req.body as { plan?: Plan }

        const checkout = await createSubscription({
            user_id: userId,
            plan: plan as Exclude<Plan, "FREE">,
        })

        res.status(201).json(checkout)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create subscription"
        const statusCode =
            message === "Invalid subscription plan" ? 400 :
            message === "User not found" ? 404 :
            message === "User already has an active subscription" ? 409 :
            500

        res.status(statusCode).json({ error: message })
    }
}

export async function getMyPlanController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const plan = await getMyPlan(userId)

        res.status(200).json(plan)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get subscription plan"
        res.status(500).json({ error: message })
    }
}

export async function getPlanLimitsController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const limits = await getPlanLimits(userId)

        res.status(200).json(limits)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get plan limits"
        res.status(500).json({ error: message })
    }
}

export async function getPlanQuotaController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const quota = await getPlanQuota(userId)

        res.status(200).json(quota)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get plan quota"
        res.status(500).json({ error: message })
    }
}

export async function stripeWebhookController(req: Request, res: Response): Promise<void> {
    try {
        const signature = req.headers["stripe-signature"]
        const result = await handleStripeWebhook(
            req.body as Buffer,
            Array.isArray(signature) ? signature[0] : signature,
        )

        res.status(200).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to handle Stripe webhook"
        res.status(400).json({ error: message })
    }
}

export async function canCreateProjectController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const result = await canCreateProject(userId)

        res.status(200).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to check project limit"
        res.status(500).json({ error: message })
    }
}

export async function canCreatePromptController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const result = await canCreatePrompt(userId)

        res.status(200).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to check prompt limit"
        res.status(500).json({ error: message })
    }
}

export async function canAddCompetitorController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const result = await canAddCompetitor(userId)

        res.status(200).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to check competitor limit"
        res.status(500).json({ error: message })
    }
}

export async function canRunRefreshController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const result = await canRunRefresh(userId)

        res.status(200).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to check refresh limit"
        res.status(500).json({ error: message })
    }
}

export async function canUseSaraController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const result = await canUseSara(userId)

        res.status(200).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to check Sara access"
        res.status(500).json({ error: message })
    }
}

export async function canExportController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const result = await canExport(userId)

        res.status(200).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to check export access"
        res.status(500).json({ error: message })
    }
}

export async function refreshPlanUsageController(req: Request, res: Response): Promise<void> {
    try {
        const { user: { id: userId } } = req as AuthenticatedRequest
        const usage = await refreshPlanUsage(userId)

        res.status(200).json(usage)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to refresh plan usage"
        res.status(500).json({ error: message })
    }
}
