import { Request, Response } from 'express'
import { getDiscoveredBrands, addCompetitor, getTrackedCompetitors, removeCompetitor } from './brand_service'
import { assertCompetitorAccess, assertCompetitorMutationAccess, assertProjectAccess, assertProjectMutationAccess } from '../projects/project_access'
import type { AuthenticatedRequest } from '../../middleware/auth'
import type { DashboardFilters } from '../dashboard/dashboard_service'

function parseFilters(query: Request['query']): DashboardFilters {
    const filters: DashboardFilters = {}
    if (query.days) filters.days = parseInt(query.days as string)
    if (query.model && query.model !== 'all') filters.model = query.model as string
    if (query.topic && query.topic !== 'all') filters.topic = query.topic as string
    if (query.prompt_id && query.prompt_id !== 'all') filters.prompt_id = query.prompt_id as string
    if (query.q) filters.q = query.q as string
    return filters
}

export const getDiscoveredBrandsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }
        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
        const brands = await getDiscoveredBrands(project_id, parseFilters(req.query))
        res.status(200).json(brands)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to get discovered brands' })
    }
}

export const addCompetitorController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        const { name, url } = req.body
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }
        if (!name) {
            res.status(400).json({ error: 'name is required' })
            return
        }
        const userId = (req as AuthenticatedRequest).user.id
        await assertProjectMutationAccess(project_id, userId)
        const competitor = await addCompetitor({ project_id, name, url, user_id: userId })
        res.status(201).json(competitor)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        if (error instanceof Error && error.message.toLowerCase().includes('competitor')) {
            res.status(403).json({ error: error.message })
            return
        }
        res.status(500).json({ error: 'Failed to add competitor' })
    }
}

export const getTrackedCompetitorsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }
        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
        const competitors = await getTrackedCompetitors(project_id, parseFilters(req.query))
        res.status(200).json(competitors)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to get tracked competitors' })
    }
}

export const removeCompetitorController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { competitor_id } = req.params
        if (!competitor_id || Array.isArray(competitor_id)) {
            res.status(400).json({ error: 'competitor_id is required' })
            return
        }
        await assertCompetitorMutationAccess(competitor_id, (req as AuthenticatedRequest).user.id)
        await removeCompetitor(competitor_id)
        res.status(200).json({ message: 'Competitor removed' })
    } catch (error) {
        if (error instanceof Error && error.message === 'COMPETITOR_NOT_FOUND') {
            res.status(404).json({ error: 'Competitor not found' })
            return
        }
        res.status(500).json({ error: 'Failed to remove competitor' })
    }
}
