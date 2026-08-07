import { Request, Response } from 'express'
import { z } from 'zod'
import {
    getPromptsWithStats, activatePrompt, deactivatePrompt, getPromptStats,
    getPromptTopics, createTopic, createPrompt,
    GEO_COUNTRIES, getGeoVariantsForPrompt, addGeoVariant, removeGeoVariant,
    toggleGeoVariant, getGeoVisibilityStats, getGeoCountryByName,
} from './prompt_service'
import { discoverPromptCandidates } from './prompt_discovery_service'
import { assertProjectAccess, assertProjectMutationAccess, assertPromptAccess } from '../projects/project_access'
import type { AuthenticatedRequest } from '../../middleware/auth'
import { assertCanCreatePrompts } from '../subscription/subscription_service'
import prisma from '../../lib/prisma'

const createTopicSchema = z.object({
    name: z.string().trim().min(2, 'Topic name must be at least 2 characters').max(80, 'Topic name is too long'),
})

const createPromptSchema = z.object({
    text: z.string().trim().min(8, 'Prompt must be at least 8 characters').max(500, 'Prompt is too long'),
    topic: z.string().trim().min(2, 'Topic is required').max(80, 'Topic is too long'),
    country_code: z.string().trim().optional(),
    country_name: z.string().trim().optional(),
})

function readRouteParam(value: string | string[] | undefined): string | null {
    return typeof value === 'string' && value ? value : null
}

export const getPromptsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)

        const status = req.query.status as any
        const topic = req.query.topic as string
        const model = req.query.model as string
        const days = req.query.days ? parseInt(req.query.days as string) : undefined
        const country = req.query.country as string
        const intent = req.query.intent as string
        const tag = req.query.tag as string
        const mentioned = req.query.mentioned === 'true' || req.query.mentioned === 'false' ? req.query.mentioned === 'true' : undefined
        const cited = req.query.cited === 'true' || req.query.cited === 'false' ? req.query.cited === 'true' : undefined

        const prompts = await getPromptsWithStats({ project_id, status, topic, model, days, country, intent, tag, mentioned, cited })
        res.status(200).json(prompts)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to get prompts' })
    }
}

export const getPromptTopicsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertProjectAccess(project_id, user_id)

        const topics = await getPromptTopics(project_id)
        res.status(200).json({ topics })
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to get prompt topics' })
    }
}

export const createTopicController = async (req: Request, res: Response): Promise<void> => {
    const parsed = createTopicSchema.safeParse(req.body)
    if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors
        const firstError = Object.values(fieldErrors).flat().find(Boolean)
        res.status(400).json({
            success: false,
            error: firstError ?? 'Invalid topic payload',
            errors: fieldErrors,
        })
        return
    }

    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }

        await assertProjectMutationAccess(project_id, (req as AuthenticatedRequest).user.id)

        const topic = await createTopic({
            project_id,
            name: parsed.data.name,
        })

        res.status(201).json({ success: true, topic })
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to create topic' })
    }
}

export const createPromptController = async (req: Request, res: Response): Promise<void> => {
    const parsed = createPromptSchema.safeParse(req.body)
    if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors
        const firstError = Object.values(fieldErrors).flat().find(Boolean)
        res.status(400).json({
            success: false,
            error: firstError ?? 'Invalid prompt payload',
            errors: fieldErrors,
        })
        return
    }

    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }

        const user = (req as AuthenticatedRequest).user
        const project = await assertProjectMutationAccess(project_id, user.id)

        const topics = await getPromptTopics(project_id)
        const topicExists = topics.some(topic => topic.name.toLowerCase() === parsed.data.topic.trim().toLowerCase())
        if (!topicExists) {
            res.status(400).json({ success: false, error: 'Please select an existing topic' })
            return
        }

        await assertCanCreatePrompts(user.id, 1)

        // For agencies, if no country is specified, default to the client's project brand_location
        let country_code = parsed.data.country_code
        let country_name = parsed.data.country_name
        if (!country_code && user.account_type === "AGENCY") {
            const matchedCountry = getGeoCountryByName(project.brand_location)
            if (matchedCountry) {
                country_code = matchedCountry.code
                country_name = matchedCountry.name
            } else {
                country_code = "US" // ultimate fallback
                country_name = "United States"
            }
        }

        const prompt = await createPrompt({
            project_id,
            text: parsed.data.text,
            topic: parsed.data.topic,
            country_code,
            country_name,
        })

        res.status(201).json({ success: true, prompt })
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        if (error instanceof Error && error.message.includes('plan')) {
            res.status(400).json({ error: error.message })
            return
        }
        res.status(500).json({ error: 'Failed to create prompt' })
    }
}

export const getPromptStatsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }

        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)

        const stats = await getPromptStats(project_id)
        res.status(200).json(stats)
    } catch (error) {
        res.status(500).json({ error: 'Failed to get prompt stats' })
    }
}

export const discoverPromptsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { project_id } = req.params
        if (!project_id || Array.isArray(project_id)) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }

        await assertProjectMutationAccess(project_id, (req as AuthenticatedRequest).user.id)
        const result = await discoverPromptCandidates(project_id)
        res.status(201).json(result)
    } catch (error) {
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
            res.status(404).json({ error: 'Project not found' })
            return
        }
        res.status(500).json({ error: 'Failed to discover prompt suggestions' })
    }
}

export const deletePromptController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { prompt_id } = req.params
        if (!prompt_id || Array.isArray(prompt_id)) {
            res.status(400).json({ error: 'prompt_id is required' })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertPromptMutationAccess(prompt_id, user_id)
        await deletePrompt(prompt_id)
        res.status(200).json({ success: true })
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete prompt' })
    }
}

export const activatePromptController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { prompt_id } = req.params
        if (!prompt_id || Array.isArray(prompt_id)) {
            res.status(400).json({ error: 'prompt_id is required' })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertPromptMutationAccess(prompt_id, user_id)
        const currentPrompt = await prisma.prompt.findUnique({
            where: { id: prompt_id },
            select: { status: true, is_active: true },
        })
        if (!currentPrompt) {
            res.status(404).json({ error: 'Prompt not found' })
            return
        }
        if (currentPrompt.status !== 'ACTIVE' || !currentPrompt.is_active) {
            await assertCanCreatePrompts(user_id, 1)
        }
        const prompt = await activatePrompt(prompt_id)
        res.status(200).json(prompt)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to activate prompt'
        res.status(message.includes('plan') || message.includes('remaining') ? 400 : 500).json({ error: message })
    }
}

export const deactivatePromptController = async (req: Request, res: Response): Promise<void> => {
    try {
        const { prompt_id } = req.params
        if (!prompt_id || Array.isArray(prompt_id)) {
            res.status(400).json({ error: 'prompt_id is required' })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        await assertPromptMutationAccess(prompt_id, user_id)
        const prompt = await deactivatePrompt(prompt_id)
        res.status(200).json(prompt)
    } catch (error) {
        res.status(500).json({ error: 'Failed to deactivate prompt' })
    }
}

// ─── Geo Variant Controllers ──────────────────────────────────────────────────

/** GET /prompts/geo/countries */
export const listGeoCountriesController = async (_req: Request, res: Response): Promise<void> => {
    res.json({ countries: GEO_COUNTRIES })
}

/** GET /prompts/:prompt_id/geo */
export const listGeoVariantsController = async (req: Request, res: Response): Promise<void> => {
    try {
        const prompt_id = readRouteParam(req.params.prompt_id)
        if (!prompt_id) {
            res.status(400).json({ error: 'prompt_id is required' })
            return
        }
        const user_id = (req as AuthenticatedRequest).user.id
        await assertPromptAccess(prompt_id, user_id)
        const variants = await getGeoVariantsForPrompt(prompt_id)
        res.json({ variants })
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch geo variants' })
    }
}

/** POST /prompts/:prompt_id/geo
 *  Body: { country_code, country_name, city? }
 */
export const addGeoVariantController = async (req: Request, res: Response): Promise<void> => {
    const { country_code, country_name, city } = req.body as {
        country_code: string; country_name: string; city?: string
    }
    if (!country_code || !country_name) {
        res.status(400).json({ error: 'country_code and country_name are required' })
        return
    }
    try {
        const prompt_id = readRouteParam(req.params.prompt_id)
        if (!prompt_id) {
            res.status(400).json({ error: 'prompt_id is required' })
            return
        }
        const user_id = (req as AuthenticatedRequest).user.id
        await assertPromptMutationAccess(prompt_id, user_id)
        const variant = await addGeoVariant({
            prompt_id,
            country_code,
            country_name,
            city,
        })
        res.status(201).json({ variant })
    } catch (error: any) {
        if (error?.code === 'P2002') {
            res.status(409).json({ error: 'This location is already tracked for this prompt' })
            return
        }
        res.status(500).json({ error: 'Failed to add geo variant' })
    }
}

/** DELETE /prompts/geo/variants/:variant_id */
export const deleteGeoVariantController = async (req: Request, res: Response): Promise<void> => {
    try {
        const variant_id = readRouteParam(req.params.variant_id)
        if (!variant_id) {
            res.status(400).json({ error: 'variant_id is required' })
            return
        }
        const variant = await prisma.promptGeoVariant.findUnique({ where: { id: variant_id } })
        if (!variant) {
            res.status(404).json({ error: 'Variant not found' })
            return
        }
        await assertPromptMutationAccess(variant.prompt_id, (req as AuthenticatedRequest).user.id)
        await removeGeoVariant(variant_id)
        res.json({ success: true })
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete geo variant' })
    }
}

/** PATCH /prompts/geo/variants/:variant_id/toggle
 *  Body: { is_active: boolean }
 */
export const toggleGeoVariantController = async (req: Request, res: Response): Promise<void> => {
    const { is_active } = req.body as { is_active: boolean }
    try {
        const variant_id = readRouteParam(req.params.variant_id)
        if (!variant_id) {
            res.status(400).json({ error: 'variant_id is required' })
            return
        }
        const existingVariant = await prisma.promptGeoVariant.findUnique({ where: { id: variant_id } })
        if (!existingVariant) {
            res.status(404).json({ error: 'Variant not found' })
            return
        }
        await assertPromptMutationAccess(existingVariant.prompt_id, (req as AuthenticatedRequest).user.id)
        const variant = await toggleGeoVariant(variant_id, is_active)
        res.json({ variant })
    } catch (error) {
        res.status(500).json({ error: 'Failed to update geo variant' })
    }
}

/** GET /prompts/:project_id/geo-stats?days=30 */
export const getGeoStatsController = async (req: Request, res: Response): Promise<void> => {
    const days = req.query.days ? Number(req.query.days) : undefined
    try {
        const project_id = readRouteParam(req.params.project_id)
        if (!project_id) {
            res.status(400).json({ error: 'project_id is required' })
            return
        }
        await assertProjectAccess(project_id, (req as AuthenticatedRequest).user.id)
        const stats = await getGeoVisibilityStats(project_id, days)
        res.json({ stats })
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch geo stats' })
    }
}
