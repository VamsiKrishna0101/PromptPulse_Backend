import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../../middleware/auth"
import prisma from "../../../lib/prisma"
import { VOICE_PLAYBOOKS } from "./voice_playbooks"
import { synthesizeTeluguVoiceAudio } from "./voice_speech_service"
import {
    getOrCreateVoiceAccount,
    parseRecipientCsv,
    createVoiceCampaign,
    launchVoiceCampaign,
} from "./voice_service"
import { isWithinCallingHoursIST, processVoiceCampaignBatch } from "./voice_worker_queue"
import type { VoicePlaybookType } from "./voice_types"

function userId(req: Request): string {
    return (req as AuthenticatedRequest).user?.id || "anonymous-user"
}

function handleError(error: unknown, res: Response, fallback: string) {
    console.error(`[voice_controller] ${fallback}:`, error)
    res.status(500).json({ error: fallback, details: error instanceof Error ? error.message : String(error) })
}

/** GET /api/campaigns/voice/account?project_id=xxx */
export async function getVoiceAccountController(req: Request, res: Response) {
    try {
        const projectId = req.query.project_id as string
        if (!projectId) { res.status(400).json({ error: "project_id required" }); return }
        const uid = userId(req)
        const account = await getOrCreateVoiceAccount(projectId, uid)
        const timeStatus = isWithinCallingHoursIST()
        res.json({ account, timeStatus })
    } catch (err) { handleError(err, res, "Failed to load voice account") }
}

/** GET /api/campaigns/voice/playbooks */
export async function getPlaybooksController(_req: Request, res: Response) {
    try {
        res.json(Object.values(VOICE_PLAYBOOKS))
    } catch (err) { handleError(err, res, "Failed to load playbooks") }
}

/** PUT /api/campaigns/voice/agent */
export async function updateVoiceAgentController(req: Request, res: Response) {
    try {
        const { agentId, name, playbook_type, language, voice_name, system_prompt, live_transfer_number, emergency_keywords } = req.body
        if (!agentId) { res.status(400).json({ error: "agentId required" }); return }

        const updated = await prisma.voiceAgentConfig.update({
            where: { id: agentId },
            data: {
                name,
                playbook_type: playbook_type as VoicePlaybookType,
                language,
                voice_name,
                system_prompt,
                live_transfer_number,
                emergency_keywords,
            },
        })
        res.json(updated)
    } catch (err) { handleError(err, res, "Failed to update voice agent persona") }
}

/** POST /api/campaigns/voice/synthesize-preview */
export async function synthesizeVoicePreviewController(req: Request, res: Response) {
    try {
        const { text, voiceName, language } = req.body
        if (!text) { res.status(400).json({ error: "text required" }); return }

        const result = await synthesizeTeluguVoiceAudio({
            text,
            voiceName: voiceName || "te-IN-ShrutiNeural",
            language: language || "te-IN",
        })

        res.setHeader("Content-Type", result.contentType)
        res.setHeader("X-Live-Azure", result.isLiveAzure ? "true" : "false")
        res.send(result.audioBuffer)
    } catch (err) { handleError(err, res, "Failed to synthesize voice preview") }
}

/** POST /api/campaigns/voice/parse-csv */
export async function parseCsvController(req: Request, res: Response) {
    try {
        const { csvText } = req.body
        if (!csvText) { res.status(400).json({ error: "csvText required" }); return }
        const parsed = parseRecipientCsv(csvText)
        res.json({ count: parsed.length, recipients: parsed })
    } catch (err) { handleError(err, res, "Failed to parse CSV") }
}

/** POST /api/campaigns/voice/campaigns */
export async function createVoiceCampaignController(req: Request, res: Response) {
    try {
        const { accountId, agentId, name, playbookType, recipients, concurrentLimit, autoLaunch } = req.body
        if (!accountId || !agentId || !name) {
            res.status(400).json({ error: "Missing required fields" })
            return
        }

        const campaign = await createVoiceCampaign({
            accountId,
            agentId,
            name,
            playbookType: playbookType || "OPD_APPOINTMENT_CONFIRMATION",
            recipients: recipients || [],
            concurrentLimit: Number(concurrentLimit) || 10,
        })

        if (autoLaunch) {
            await launchVoiceCampaign(campaign.id)
        }

        res.json(campaign)
    } catch (err) { handleError(err, res, "Failed to create voice campaign") }
}

/** GET /api/campaigns/voice/campaigns?project_id=xxx */
export async function listVoiceCampaignsController(req: Request, res: Response) {
    try {
        const projectId = req.query.project_id as string
        if (!projectId) { res.status(400).json({ error: "project_id required" }); return }

        const account = await prisma.voiceAccount.findUnique({
            where: { project_id: projectId },
        })

        if (!account) {
            res.json([])
            return
        }

        const campaigns = await prisma.voiceCampaign.findMany({
            where: { account_id: account.id },
            orderBy: { created_at: "desc" },
            include: { agent: true },
        })

        res.json(campaigns)
    } catch (err) { handleError(err, res, "Failed to list voice campaigns") }
}

/** GET /api/campaigns/voice/campaigns/:id */
export async function getVoiceCampaignController(req: Request, res: Response) {
    try {
        const campaign = await prisma.voiceCampaign.findUnique({
            where: { id: req.params.id },
            include: { agent: true },
        })
        if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return }
        const timeStatus = isWithinCallingHoursIST()
        res.json({ campaign, timeStatus })
    } catch (err) { handleError(err, res, "Failed to fetch voice campaign") }
}

/** GET /api/campaigns/voice/campaigns/:id/records */
export async function listVoiceRecordsController(req: Request, res: Response) {
    try {
        const campaignId = req.params.id
        const status = req.query.status as string | undefined
        const intent = req.query.intent as string | undefined

        const where: any = { campaign_id: campaignId }
        if (status) where.status = status
        if (intent) where.outcome_intent = intent

        const records = await prisma.voiceCallRecord.findMany({
            where,
            orderBy: { created_at: "desc" },
        })

        res.json(records)
    } catch (err) { handleError(err, res, "Failed to load call records") }
}

/** POST /api/campaigns/voice/campaigns/:id/launch */
export async function launchCampaignController(req: Request, res: Response) {
    try {
        const campaignId = req.params.id
        const campaign = await launchVoiceCampaign(campaignId)
        res.json(campaign)
    } catch (err) { handleError(err, res, "Failed to launch voice campaign") }
}

/** POST /api/campaigns/voice/campaigns/:id/process-batch */
export async function processBatchController(req: Request, res: Response) {
    try {
        const campaignId = req.params.id
        await processVoiceCampaignBatch(campaignId)
        const updated = await prisma.voiceCampaign.findUnique({ where: { id: campaignId } })
        res.json(updated)
    } catch (err) { handleError(err, res, "Failed to process campaign batch") }
}
