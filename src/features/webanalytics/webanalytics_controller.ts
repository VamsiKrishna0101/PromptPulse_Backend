import { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { assertProjectAccess } from "../projects/project_access"
import {
    collectActionSchema,
    collectEventSchema,
    createCustomEventSchema,
    createSiteSchema,
    updateCustomEventSchema,
    updateSiteSchema,
} from "./webanalytics_types"
import {
    collectAnalyticsAction,
    collectAnalyticsEvent,
    createAnalyticsSite,
    createCustomEvent,
    deleteAnalyticsSite,
    deleteCustomEvent,
    getAnalyticsBreakdown,
    getAnalyticsDurations,
    getAnalyticsEvents,
    getAnalyticsFacts,
    getAnalyticsPages,
    getAnalyticsReferrers,
    getAnalyticsSummary,
    getAnalyticsTimeseries,
    getCustomEventStats,
    getTrackerScript,
    listAnalyticsSites,
    listCustomEvents,
    parseAnalyticsRange,
    regenerateAnalyticsSiteKey,
    updateAnalyticsSite,
    updateCustomEvent,
} from "./webanalytics_service"

export async function createAnalyticsSiteController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(201).json(await createAnalyticsSite(project_id, createSiteSchema.parse(req.body)))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to create analytics site")
    }
}

export async function listAnalyticsSitesController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await listAnalyticsSites(project_id))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to list analytics sites")
    }
}

export async function updateAnalyticsSiteController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await updateAnalyticsSite(project_id, routeParam(req, "site_id"), updateSiteSchema.parse(req.body)))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to update analytics site")
    }
}

export async function deleteAnalyticsSiteController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await deleteAnalyticsSite(project_id, routeParam(req, "site_id")))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to delete analytics site")
    }
}

export async function regenerateAnalyticsSiteKeyController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await regenerateAnalyticsSiteKey(project_id, routeParam(req, "site_id")))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to regenerate analytics site key")
    }
}

export async function collectAnalyticsEventController(req: Request, res: Response) {
    try {
        const result = await collectAnalyticsEvent(collectEventSchema.parse(req.body), requestMeta(req))
        res.status(202).json(result)
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to collect analytics event")
    }
}

export async function collectAnalyticsActionController(req: Request, res: Response) {
    try {
        const result = await collectAnalyticsAction(collectActionSchema.parse(req.body), requestMeta(req))
        res.status(202).json(result)
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to collect analytics action")
    }
}

export async function getTrackerScriptController(_req: Request, res: Response) {
    res.type("application/javascript").send(getTrackerScript())
}

export async function getAnalyticsSummaryController(req: Request, res: Response) {
    await report(req, res, getAnalyticsSummary, "Failed to retrieve analytics summary")
}

export async function getAnalyticsFactsController(req: Request, res: Response) {
    await report(req, res, getAnalyticsFacts, "Failed to retrieve analytics facts")
}

export async function getAnalyticsTimeseriesController(req: Request, res: Response) {
    await report(req, res, getAnalyticsTimeseries, "Failed to retrieve analytics timeseries")
}

export async function getAnalyticsPagesController(req: Request, res: Response) {
    await report(req, res, getAnalyticsPages, "Failed to retrieve analytics pages")
}

export async function getAnalyticsReferrersController(req: Request, res: Response) {
    await report(req, res, getAnalyticsReferrers, "Failed to retrieve analytics referrers")
}

export async function getAnalyticsDurationsController(req: Request, res: Response) {
    await report(req, res, getAnalyticsDurations, "Failed to retrieve analytics durations")
}

export async function getAnalyticsBreakdownController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await getAnalyticsBreakdown(
            project_id,
            parseAnalyticsRange(req.query.days),
            routeParam(req, "dimension"),
            Number(req.query.limit ?? 25),
        ))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to retrieve analytics breakdown")
    }
}

export async function getAnalyticsEventsController(req: Request, res: Response) {
    await report(req, res, getAnalyticsEvents, "Failed to retrieve analytics events")
}

export async function createCustomEventController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(201).json(await createCustomEvent(project_id, routeParam(req, "site_id"), createCustomEventSchema.parse(req.body)))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to create custom event")
    }
}

export async function listCustomEventsController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await listCustomEvents(project_id, routeParam(req, "site_id")))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to list custom events")
    }
}

export async function updateCustomEventController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await updateCustomEvent(project_id, routeParam(req, "site_id"), routeParam(req, "event_id"), updateCustomEventSchema.parse(req.body)))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to update custom event")
    }
}

export async function deleteCustomEventController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await deleteCustomEvent(project_id, routeParam(req, "site_id"), routeParam(req, "event_id")))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to delete custom event")
    }
}

export async function getCustomEventStatsController(req: Request, res: Response) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await getCustomEventStats(project_id, routeParam(req, "site_id"), routeParam(req, "event_id"), parseAnalyticsRange(req.query.days)))
    } catch (error) {
        handleWebAnalyticsError(error, res, "Failed to retrieve custom event stats")
    }
}

async function report(req: Request, res: Response, fn: (project_id: string, range: ReturnType<typeof parseAnalyticsRange>) => Promise<unknown>, fallback: string) {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return
        res.status(200).json(await fn(project_id, parseAnalyticsRange(req.query.days)))
    } catch (error) {
        handleWebAnalyticsError(error, res, fallback)
    }
}

async function getOwnedProjectId(req: Request, res: Response) {
    const { project_id } = req.params
    if (!project_id || Array.isArray(project_id)) {
        res.status(400).json({ error: "project_id is required" })
        return null
    }
    await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
    return project_id
}

function requestMeta(req: Request) {
    return { ip: req.ip, userAgent: req.get("user-agent") ?? undefined }
}

function routeParam(req: Request, name: string) {
    const value = req.params[name]
    if (!value || Array.isArray(value)) throw new Error("INVALID_ROUTE_PARAM")
    return value
}

function handleWebAnalyticsError(error: unknown, res: Response, fallback: string) {
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") return void res.status(404).json({ error: "Project not found" })
    if (error instanceof Error && error.message === "SITE_NOT_FOUND") return void res.status(404).json({ error: "Analytics site not found" })
    if (error instanceof Error && error.message === "CUSTOM_EVENT_NOT_FOUND") return void res.status(404).json({ error: "Custom analytics event not found" })
    if (error instanceof Error && error.message === "INVALID_ROUTE_PARAM") return void res.status(400).json({ error: "Invalid route parameter" })
    if (error && typeof error === "object" && "issues" in error) {
        return void res.status(400).json({ error: "Invalid request body", details: (error as { issues: unknown }).issues })
    }
    res.status(500).json({ error: fallback })
}
