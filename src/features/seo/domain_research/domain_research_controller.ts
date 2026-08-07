import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../../middleware/auth"
import { listSeoMarkets } from "../shared/seo_market"
import { toSeoErrorResponse } from "../shared/seo_errors"
import {
    getCompetitorsSnapshot,
    getKeywordGapSnapshot,
    getOrganicKeywordsSnapshot,
    getOverview,
    getSiteStructureSnapshot,
    getTopPagesSnapshot,
    listOverviewSnapshots,
    refreshCompetitorsSnapshot,
    refreshKeywordGapSnapshot,
    refreshOrganicKeywordsSnapshot,
    refreshOverview,
    refreshTopPagesSnapshot,
} from "./domain_research_service"
import type {
    CompetitorsLimit,
    DomainResearchRange,
    KeywordGapLimit,
    OrganicKeywordsLimit,
    TopPagesLimit,
} from "./domain_research_types"

const scopeSchema = z.object({
    domain: z.string().trim().min(3).max(253),
    country: z.string().trim().min(2).max(80),
    language_code: z.string().trim().min(2).max(10).default("en"),
})

const rangeSchema = z.coerce.number().int().min(1).max(12).refine(
    (value): value is DomainResearchRange => value >= 1 && value <= 12,
    "Range must be between 1 and 12 months",
)

const organicKeywordsLimitSchema = z.coerce.number().refine(
    (value): value is OrganicKeywordsLimit => [100, 250, 500, 1000].includes(value),
    "Keyword limit must be 100, 250, 500, or 1000",
)

const topPagesLimitSchema = z.coerce.number().refine(
    (value): value is TopPagesLimit => [25, 50, 100, 250, 500, 1000].includes(value),
    "Page limit must be 25, 50, 100, 250, 500, or 1000",
)

const competitorsLimitSchema = z.coerce.number().refine(
    (value): value is CompetitorsLimit => [25, 50, 100, 250].includes(value),
    "Competitor limit must be 25, 50, 100, or 250",
)

const keywordGapLimitSchema = z.coerce.number().refine(
    (value): value is KeywordGapLimit => [50, 100, 250].includes(value),
    "Keyword gap limit must be 50, 100, or 250",
)

function projectId(req: Request): string {
    const value = req.params.projectId
    return Array.isArray(value) ? value[0] : value
}

function userId(req: Request): string {
    return (req as AuthenticatedRequest).user.id
}

function validationError(res: Response, parsed: { error: z.ZodError }) {
    res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid SEO request",
        code: "SEO_VALIDATION_ERROR",
    })
}

function handleError(res: Response, error: unknown, operation: string) {
    const mapped = toSeoErrorResponse(error)
    if (mapped.status >= 500) {
        console.error(`[seo.domain-research] ${operation} failed`, error)
    }
    res.status(mapped.status).json(mapped.body)
}

function parseScope(req: Request) {
    return scopeSchema.safeParse(req.method === "GET" ? req.query : req.body)
}

export async function getLocationsController(_req: Request, res: Response) {
    res.status(200).json({ locations: listSeoMarkets() })
}

export async function getOverviewController(req: Request, res: Response) {
    const parsed = scopeSchema.extend({ range: rangeSchema }).safeParse(req.query)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await getOverview({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
            range: parsed.data.range,
        }))
    } catch (error) {
        handleError(res, error, "get overview")
    }
}

export async function refreshOverviewController(req: Request, res: Response) {
    const parsed = scopeSchema.extend({ range: rangeSchema }).safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await refreshOverview({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
            range: parsed.data.range,
        }))
    } catch (error) {
        handleError(res, error, "refresh overview")
    }
}

export async function getOrganicKeywordsController(req: Request, res: Response) {
    const parsed = parseScope(req)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await getOrganicKeywordsSnapshot({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
        }))
    } catch (error) {
        handleError(res, error, "get organic keywords")
    }
}

export async function refreshOrganicKeywordsController(req: Request, res: Response) {
    const parsed = scopeSchema.extend({ limit: organicKeywordsLimitSchema }).safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await refreshOrganicKeywordsSnapshot({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
            limit: parsed.data.limit,
        }))
    } catch (error) {
        handleError(res, error, "refresh organic keywords")
    }
}

export async function getTopPagesController(req: Request, res: Response) {
    const parsed = parseScope(req)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await getTopPagesSnapshot({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
        }))
    } catch (error) {
        handleError(res, error, "get top pages")
    }
}

export async function refreshTopPagesController(req: Request, res: Response) {
    const parsed = scopeSchema.extend({ limit: topPagesLimitSchema }).safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await refreshTopPagesSnapshot({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
            limit: parsed.data.limit,
        }))
    } catch (error) {
        handleError(res, error, "refresh top pages")
    }
}

export async function getCompetitorsController(req: Request, res: Response) {
    const parsed = parseScope(req)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await getCompetitorsSnapshot({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
        }))
    } catch (error) {
        handleError(res, error, "get competitors")
    }
}

export async function refreshCompetitorsController(req: Request, res: Response) {
    const parsed = scopeSchema.extend({ limit: competitorsLimitSchema }).safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await refreshCompetitorsSnapshot({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
            limit: parsed.data.limit,
        }))
    } catch (error) {
        handleError(res, error, "refresh competitors")
    }
}

export async function getKeywordGapController(req: Request, res: Response) {
    const parsed = scopeSchema.extend({
        competitor_domain: z.string().trim().min(3).max(253),
    }).safeParse(req.query)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await getKeywordGapSnapshot({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
            competitorDomain: parsed.data.competitor_domain,
        }))
    } catch (error) {
        handleError(res, error, "get keyword gap")
    }
}

export async function refreshKeywordGapController(req: Request, res: Response) {
    const parsed = scopeSchema.extend({
        competitor_domain: z.string().trim().min(3).max(253),
        limit: keywordGapLimitSchema,
    }).safeParse(req.body)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await refreshKeywordGapSnapshot({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
            competitorDomain: parsed.data.competitor_domain,
            limit: parsed.data.limit,
        }))
    } catch (error) {
        handleError(res, error, "refresh keyword gap")
    }
}

export async function getSiteStructureController(req: Request, res: Response) {
    const parsed = parseScope(req)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await getSiteStructureSnapshot({
            projectId: projectId(req),
            userId: userId(req),
            domain: parsed.data.domain,
            country: parsed.data.country,
            languageCode: parsed.data.language_code,
        }))
    } catch (error) {
        handleError(res, error, "get site structure")
    }
}

export async function listSnapshotsController(req: Request, res: Response) {
    const parsed = z.object({
        page: z.coerce.number().int().min(1).default(1),
        page_size: z.coerce.number().int().min(1).max(50).default(8),
    }).safeParse(req.query)
    if (!parsed.success) return validationError(res, parsed)
    try {
        res.status(200).json(await listOverviewSnapshots({
            projectId: projectId(req),
            userId: userId(req),
            page: parsed.data.page,
            pageSize: parsed.data.page_size,
        }))
    } catch (error) {
        handleError(res, error, "list snapshots")
    }
}
