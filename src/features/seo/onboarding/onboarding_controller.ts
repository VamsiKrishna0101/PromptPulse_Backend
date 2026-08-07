import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../../middleware/auth"
import {
    approveOnboardingRecommendation,
    getLatestOnboardingRun,
    getOnboardingRun,
    rejectOnboardingRecommendation,
    retryOnboarding,
    startOnboarding,
} from "./onboarding_service"

const onboardingSchema = z.object({
    tier: z.enum(["quick", "standard", "deep"]).default("standard"),
    max_credits: z.coerce.number().int().min(20).max(500).optional(),
    country: z.string().trim().min(2).max(80),
    language_code: z.string().trim().min(2).max(10).default("en"),
    services: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    target_audience: z.string().trim().max(500).optional(),
    goals: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    competitor_domains: z.array(z.string().trim().min(3).max(253)).max(5).optional(),
    max_pages: z.coerce.number().int().min(1).max(50).optional(),
    include_provider_research: z.boolean().default(true),
    include_backlinks: z.boolean().default(true),
    run_ai_visibility: z.boolean().optional(),
    ai_prompt_count: z.coerce.number().int().min(1).max(8).optional(),
})

function actor(req: Request) { return (req as AuthenticatedRequest).user.id }
function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? "" }
function handle(res: Response, error: unknown) {
    const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: unknown }).status) : 500
    res.status(Number.isFinite(status) && status >= 400 ? status : 500).json({ error: error instanceof Error ? error.message : "Strategy audit request failed" })
}

export async function startOnboardingController(req: Request, res: Response) {
    const parsed = onboardingSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid strategy audit request", code: "SEO_VALIDATION_ERROR" })
    try {
        res.status(202).json(await startOnboarding({ projectId: param(req.params.projectId), actorUserId: actor(req), onboarding: parsed.data }))
    } catch (error) { handle(res, error) }
}

export async function getLatestOnboardingController(req: Request, res: Response) {
    try {
        const run = await getLatestOnboardingRun(param(req.params.projectId), actor(req))
        res.json({ run })
    } catch (error) { handle(res, error) }
}

export async function getOnboardingController(req: Request, res: Response) {
    try { res.json(await getOnboardingRun(param(req.params.runId), actor(req))) }
    catch (error) { handle(res, error) }
}

export async function retryOnboardingController(req: Request, res: Response) {
    try { res.status(202).json(await retryOnboarding(param(req.params.runId), actor(req))) }
    catch (error) { handle(res, error) }
}

export async function approveRecommendationController(req: Request, res: Response) {
    try { res.json(await approveOnboardingRecommendation(param(req.params.recommendationId), actor(req))) }
    catch (error) { handle(res, error) }
}

export async function rejectRecommendationController(req: Request, res: Response) {
    try { res.json(await rejectOnboardingRecommendation(param(req.params.recommendationId), actor(req))) }
    catch (error) { handle(res, error) }
}
