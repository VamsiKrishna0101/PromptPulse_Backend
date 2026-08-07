import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../../middleware/auth"
import { toSeoErrorResponse } from "../shared/seo_errors"
import { rankTrackingService } from "./rank_tracking_service"

const uuid = z.string().uuid()
const deviceMode = z.enum(["desktop", "mobile", "both"])
const schedule = z.enum(["daily", "weekly", "monthly", "manual"])

const createSchema = z.object({
    domain: z.string().trim().min(1).max(253),
    location_code: z.coerce.number().int().positive().default(2356),
    location_name: z.string().trim().min(1).max(200).nullable().optional(),
    language_code: z.string().trim().min(2).max(10).default("en"),
    device_mode: deviceMode.default("both"),
    serp_depth: z.coerce.number().int().min(10).max(100).multipleOf(10).default(20),
    schedule_interval: schedule.default("weekly"),
})

const updateSchema = createSchema.partial().extend({
    is_active: z.boolean().optional(),
})

const keywordsSchema = z.object({
    keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
})

const keywordIdsSchema = z.object({
    keyword_ids: z.array(uuid).min(1).max(500),
})

const runSchema = z.object({
    keyword_ids: z.array(uuid).min(1).max(500).optional(),
})

function params(req: Request) {
    const single = (value: string | string[] | undefined) =>
        Array.isArray(value) ? value[0] : value ?? ""
    return {
        projectId: single(req.params.projectId),
        configId: single(req.params.configId),
        keywordId: single(req.params.keywordId),
    }
}

function userId(req: Request) {
    return (req as AuthenticatedRequest).user.id
}

function fail(res: Response, error: unknown) {
    const mapped = toSeoErrorResponse(error)
    if (mapped.status >= 500) console.error("[seo.rank-tracking] request failed", error)
    res.status(mapped.status).json(mapped.body)
}

export async function listConfigsController(req: Request, res: Response) {
    try {
        res.json(await rankTrackingService.listConfigs({
            projectId: params(req).projectId,
            userId: userId(req),
        }))
    } catch (error) { fail(res, error) }
}

export async function createConfigController(req: Request, res: Response) {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        return
    }
    try {
        res.status(201).json(await rankTrackingService.createConfig({
            projectId: params(req).projectId,
            userId: userId(req),
            domain: parsed.data.domain,
            locationCode: parsed.data.location_code,
            locationName: parsed.data.location_name,
            languageCode: parsed.data.language_code,
            deviceMode: parsed.data.device_mode,
            serpDepth: parsed.data.serp_depth,
            scheduleInterval: parsed.data.schedule_interval,
        }))
    } catch (error) { fail(res, error) }
}

export async function updateConfigController(req: Request, res: Response) {
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        return
    }
    try {
        res.json(await rankTrackingService.updateConfig({
            projectId: params(req).projectId,
            configId: params(req).configId,
            userId: userId(req),
            domain: parsed.data.domain,
            locationCode: parsed.data.location_code,
            locationName: parsed.data.location_name,
            languageCode: parsed.data.language_code,
            deviceMode: parsed.data.device_mode,
            serpDepth: parsed.data.serp_depth,
            scheduleInterval: parsed.data.schedule_interval,
            isActive: parsed.data.is_active,
        }))
    } catch (error) { fail(res, error) }
}

export async function keywordsController(req: Request, res: Response) {
    try {
        res.json(await rankTrackingService.getKeywords({
            projectId: params(req).projectId,
            configId: params(req).configId,
            userId: userId(req),
        }))
    } catch (error) { fail(res, error) }
}

export async function addKeywordsController(req: Request, res: Response) {
    const parsed = keywordsSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        return
    }
    try {
        res.status(201).json(await rankTrackingService.addKeywords({
            projectId: params(req).projectId,
            configId: params(req).configId,
            userId: userId(req),
            keywords: parsed.data.keywords,
        }))
    } catch (error) { fail(res, error) }
}

export async function removeKeywordsController(req: Request, res: Response) {
    const parsed = keywordIdsSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        return
    }
    try {
        res.json(await rankTrackingService.removeKeywords({
            projectId: params(req).projectId,
            configId: params(req).configId,
            userId: userId(req),
            keywordIds: parsed.data.keyword_ids,
        }))
    } catch (error) { fail(res, error) }
}

function parsedRunInput(req: Request, res: Response) {
    const parsed = runSchema.safeParse(req.method === "GET" ? req.query : req.body)
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        return null
    }
    return {
        projectId: params(req).projectId,
        configId: params(req).configId,
        userId: userId(req),
        keywordIds: parsed.data.keyword_ids,
    }
}

export async function estimateRunController(req: Request, res: Response) {
    const input = parsedRunInput(req, res)
    if (!input) return
    try { res.json(await rankTrackingService.estimateRun(input)) } catch (error) { fail(res, error) }
}

export async function runCheckController(req: Request, res: Response) {
    const input = parsedRunInput(req, res)
    if (!input) return
    try { res.status(202).json(await rankTrackingService.runCheck(input)) } catch (error) { fail(res, error) }
}

export async function latestResultsController(req: Request, res: Response) {
    try {
        res.json(await rankTrackingService.latestResults({
            projectId: params(req).projectId,
            configId: params(req).configId,
            userId: userId(req),
        }))
    } catch (error) { fail(res, error) }
}

export async function keywordHistoryController(req: Request, res: Response) {
    const parsed = z.object({
        since_days: z.coerce.number().int().min(1).max(730).default(365),
    }).safeParse(req.query)
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        return
    }
    try {
        res.json(await rankTrackingService.keywordHistory({
            projectId: params(req).projectId,
            configId: params(req).configId,
            keywordId: params(req).keywordId,
            userId: userId(req),
            sinceDays: parsed.data.since_days,
        }))
    } catch (error) { fail(res, error) }
}

export async function positionMatrixController(req: Request, res: Response) {
    const parsed = z.object({
        device: z.enum(["desktop", "mobile"]).default("desktop"),
        run_limit: z.coerce.number().int().min(1).max(26).default(12),
    }).safeParse(req.query)
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        return
    }
    try {
        res.json(await rankTrackingService.positionMatrix({
            projectId: params(req).projectId,
            configId: params(req).configId,
            userId: userId(req),
            device: parsed.data.device,
            runLimit: parsed.data.run_limit,
        }))
    } catch (error) { fail(res, error) }
}
