import { Request, Response } from 'express'
import { runPrompt, getDashboardData, getVisibilityTimeSeries, getRecentChats, getChatsPage, getFilterOptions } from './dashboard_service'
import type { DashboardFilters } from './dashboard_service'
import { assertProjectAccess, assertPromptAccess, assertRunAccess } from '../projects/project_access'
import type { AuthenticatedRequest } from '../../middleware/auth'

function parseFilters(query: Request['query']): DashboardFilters {
    const filters: DashboardFilters = {}
    if (query.days) filters.days = parseInt(query.days as string)
    if (query.model && query.model !== 'all') filters.model = query.model as string
    if (query.topic && query.topic !== 'all') filters.topic = query.topic as string
    if (query.tag && query.tag !== 'all') filters.tag = query.tag as string
    if (query.prompt_id && query.prompt_id !== 'all') filters.prompt_id = query.prompt_id as string
    if (query.q) filters.q = query.q as string
    return filters
}

export const runPromptController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { prompt_id, run_id, raw_response, ai_model } = req.body
        if (!prompt_id || !run_id || !raw_response || !ai_model) {
            res.status(400).json({ error: 'prompt_id, run_id, raw_response, and ai_model are required' })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertPromptAccess(prompt_id, user_id)
        await assertRunAccess(run_id, user_id)

        const chat = await runPrompt({ prompt_id, run_id, raw_response, ai_model })
        res.status(201).json(chat)
    } catch (error) {
        if (error instanceof Error && (error.message === 'PROMPT_NOT_FOUND' || error.message === 'RUN_NOT_FOUND')) {
            res.status(404).json({ error: 'Prompt or run not found' })
            return
        }
        res.status(500).json({ error: 'Failed to run prompt analysis' })
    }
}

export const getDashboardDataController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }

        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
        const filters = parseFilters(req.query)

        const data = await getDashboardData({ project_id, filters })
        if (!data) {
            res.status(404).json({ error: 'No data found for this project' })
            return
        }
        res.status(200).json(data)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to get dashboard data' })
    }
}

export const getVisibilityTimeSeriesController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }
        await assertProjectAccess(project_id, (req as any).user.id)
        const filters = parseFilters(req.query)
        const data = await getVisibilityTimeSeries(project_id, filters)
        res.status(200).json(data)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to get timeseries data' })
    }
}

export const getRecentChatsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }
        await assertProjectAccess(project_id, (req as any).user.id)
        const filters = parseFilters(req.query)
        const data = await getRecentChats(project_id, filters)
        res.status(200).json(data)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to get recent chats' })
    }
}

export const getChatsPageController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }
        await assertProjectAccess(project_id, (req as any).user.id)
        const filters = parseFilters(req.query)
        const page = Number.parseInt(req.query.page as string, 10) || 1
        const pageSize = Number.parseInt(req.query.page_size as string, 10) || 20
        const data = await getChatsPage(project_id, filters, page, pageSize)
        res.status(200).json(data)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to get chats' })
    }
}

export const getFilterOptionsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }
        await assertProjectAccess(project_id, (req as any).user.id)
        const data = await getFilterOptions(project_id)
        res.status(200).json(data)
    } catch (error) {
        console.error("Error in getFilterOptionsController:", error)
        res.status(500).json({ error: 'Failed to get filter options' })
    }
}
