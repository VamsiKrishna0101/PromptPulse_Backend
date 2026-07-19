import { Request, Response } from 'express'
import { getDomainReport, getSourceGaps, getSourceTrend, getTopSources, getUrlContent, getUrlReport } from './sources_service'
import { assertProjectAccess } from '../projects/project_access'
import type { AuthenticatedRequest } from '../../middleware/auth'
import type { DashboardFilters } from '../dashboard/dashboard_service'

function parseFilters(query: Request['query']): DashboardFilters {
    const filters: DashboardFilters = {}
    if (query.days) filters.days = parseInt(query.days as string, 10)
    if (query.model && query.model !== 'all') filters.model = query.model as string
    if (query.topic && query.topic !== 'all') filters.topic = query.topic as string
    if (query.tag && query.tag !== 'all') filters.tag = query.tag as string
    if (query.country && query.country !== 'all') filters.country = query.country as string
    if (query.intent && query.intent !== 'all') filters.intent = query.intent as string
    if (query.mentioned === 'true' || query.mentioned === 'false') filters.mentioned = query.mentioned === 'true'
    if (query.cited === 'true' || query.cited === 'false') filters.cited = query.cited === 'true'
    return filters
}

export const getTopSourcesController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }

        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
        
        const topSources = await getTopSources(project_id, parseFilters(req.query))
        res.status(200).json(topSources)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to retrieve top sources' })
    }
}

export const getDomainReportController = async (req: Request, res: Response): Promise<void> => {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return

        res.status(200).json(await getDomainReport(project_id, parseFilters(req.query)))
    } catch (error) {
        handleSourceError(error, res, 'Failed to retrieve domain report')
    }
}

export const getUrlReportController = async (req: Request, res: Response): Promise<void> => {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return

        res.status(200).json(await getUrlReport(project_id, parseFilters(req.query)))
    } catch (error) {
        handleSourceError(error, res, 'Failed to retrieve URL report')
    }
}

export const getUrlContentController = async (req: Request, res: Response): Promise<void> => {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return

        const url = typeof req.query.url === 'string' ? req.query.url : null
        if (!url) {
            res.status(400).json({ error: 'url query param is required' })
            return
        }

        const content = await getUrlContent(project_id, url)
        if (!content) {
            res.status(404).json({ error: 'URL content not found' })
            return
        }

        res.status(200).json(content)
    } catch (error) {
        handleSourceError(error, res, 'Failed to retrieve URL content')
    }
}

export const getSourceGapsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return

        res.status(200).json(await getSourceGaps(project_id))
    } catch (error) {
        handleSourceError(error, res, 'Failed to retrieve source gaps')
    }
}

export const getSourceTrendController = async (req: Request, res: Response): Promise<void> => {
    try {
        const project_id = await getOwnedProjectId(req, res)
        if (!project_id) return

        res.status(200).json(await getSourceTrend(project_id))
    } catch (error) {
        handleSourceError(error, res, 'Failed to retrieve source trend')
    }
}

async function getOwnedProjectId(req: Request, res: Response) {
    const { project_id } = req.params
    if (!project_id || Array.isArray(project_id)) {
        res.status(400).json({ error: 'project_id is required' })
        return null
    }

    await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
    return project_id
}

function handleSourceError(error: unknown, res: Response, fallback: string) {
    if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
        res.status(404).json({ error: 'Project not found' })
        return
    }
    res.status(500).json({ error: fallback })
}
