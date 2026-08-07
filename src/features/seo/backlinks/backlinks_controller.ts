import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../../middleware/auth"
import { toSeoErrorResponse } from "../shared/seo_errors"
import { backlinksService } from "./backlinks_service"

const baseSchema = z.object({
    target: z.string().trim().min(1).max(2048),
    scope: z.enum(["domain", "page"]).default("domain"),
})

const pageSchema = baseSchema.extend({
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().refine(
        (value): value is 50 | 100 | 200 => [50, 100, 200].includes(value),
        "Page size must be 50, 100, or 200",
    ).default(100),
    sort_order: z.enum(["asc", "desc"]).default("desc"),
    mode: z.enum(["one_per_domain", "as_is"]).default("one_per_domain"),
})

const reportSchema = baseSchema.extend({
    report_mode: z.enum(["normal", "detailed"]).default("normal"),
})

function projectId(req: Request) {
    const value = req.params.projectId
    return Array.isArray(value) ? value[0] : value
}

function common(req: Request, data: z.infer<typeof baseSchema>) {
    return {
        projectId: projectId(req),
        userId: (req as AuthenticatedRequest).user.id,
        target: data.target,
        scope: data.scope,
    }
}

function handleError(res: Response, error: unknown) {
    const mapped = toSeoErrorResponse(error)
    if (mapped.status >= 500) console.error("[seo.backlinks] request failed", error)
    res.status(mapped.status).json(mapped.body)
}

export async function backlinksOverviewController(req: Request, res: Response) {
    const parsed = baseSchema.safeParse(req.method === "GET" ? req.query : req.body)
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        return
    }
    try {
        const service = req.method === "GET"
            ? backlinksService.getOverview
            : backlinksService.refreshOverview
        res.status(200).json(await service(common(req, parsed.data)))
    } catch (error) {
        handleError(res, error)
    }
}

export async function backlinksReportsController(req: Request, res: Response) {
    try {
        res.status(200).json(await backlinksService.listReports({
            projectId: projectId(req),
            userId: (req as AuthenticatedRequest).user.id,
        }))
    } catch (error) {
        handleError(res, error)
    }
}

export async function backlinksReportController(req: Request, res: Response) {
    const parsed = reportSchema.safeParse(req.method === "GET" ? req.query : req.body)
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
        return
    }
    try {
        const service = req.method === "GET"
            ? backlinksService.getReport
            : backlinksService.refreshReport
        res.status(200).json(await service({
            ...common(req, parsed.data),
            reportMode: parsed.data.report_mode,
        }))
    } catch (error) {
        handleError(res, error)
    }
}

export function backlinksPageController(kind: "backlinks" | "domains" | "pages") {
    return async (req: Request, res: Response) => {
        const parsed = pageSchema.safeParse(req.method === "GET" ? req.query : req.body)
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0]?.message, code: "SEO_VALIDATION_ERROR" })
            return
        }
        const input = {
            ...common(req, parsed.data),
            page: parsed.data.page,
            pageSize: parsed.data.page_size,
            sortOrder: parsed.data.sort_order,
            mode: parsed.data.mode,
        }
        try {
            const service =
                kind === "backlinks"
                    ? req.method === "GET" ? backlinksService.getBacklinks : backlinksService.refreshBacklinks
                    : kind === "domains"
                        ? req.method === "GET" ? backlinksService.getReferringDomains : backlinksService.refreshReferringDomains
                        : req.method === "GET" ? backlinksService.getTopPages : backlinksService.refreshTopPages
            res.status(200).json(await service(input))
        } catch (error) {
            handleError(res, error)
        }
    }
}
