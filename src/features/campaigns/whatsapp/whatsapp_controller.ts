import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../../middleware/auth"
import { assertProjectAccess } from "../../projects/project_access"
import {
    getAccountByProject,
    createAccount,
    updateAccount,
    deleteAccount,
    syncAccountHealth,
    listTemplates,
    syncTemplatesFromMeta,
    createLocalTemplate,
    listCampaigns,
    getCampaign,
    createCampaign,
    updateCampaignStatus,
    deleteCampaign,
    listCampaignRecipients,
    updateRecipientStatus,
    updateCampaignCounts,
    accessTokenForAccount,
    checkAccountHealth,
} from "./whatsapp_service"
import {
    updateWhatsAppBusinessProfile,
    createProfilePicUploadSession,
    uploadProfilePicBinary,
    applyProfilePicHandle,
    createMetaTemplate,
    sendWhatsAppTemplateMessage,
    describeMetaError,
} from "./whatsapp_meta_api"
import { calculateCampaignCost } from "./whatsapp_types"
import { verifyMetaWebhookSignature } from "./whatsapp_webhook_security"
import { getConfiguredWhatsAppTestAccount, getWebhookVerifyToken } from "./whatsapp_config"
import { logWhatsAppEvent } from "./whatsapp_logger"
import type {
    CreateAccountInput,
    CreateCampaignInput,
    MetaTemplateCategory,
    MetaWebhookPayload,
} from "./whatsapp_types"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function userId(req: Request) {
    return (req as AuthenticatedRequest).user.id
}

function str(v: unknown): string | undefined {
    return typeof v === "string" && v.trim() ? v.trim() : undefined
}

function num(v: unknown, fallback: number): number {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
}

function handleError(error: unknown, res: Response, fallback: string) {
    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
        res.status(404).json({ error: "Project not found" })
        return
    }
    if (error instanceof Error && (error as any).status) {
        res.status((error as any).status).json({ error: error.message })
        return
    }
    console.error(`[whatsapp] ${fallback}:`, error)
    res.status(500).json({ error: fallback })
}

// ─── Account ─────────────────────────────────────────────────────────────────

/** GET /api/campaigns/whatsapp/account?project_id=xxx */
export async function getAccountController(req: Request, res: Response) {
    try {
        const projectId = str(req.query.project_id)
        if (!projectId) { res.status(400).json({ error: "project_id required" }); return }
        const uid = userId(req)
        await assertProjectAccess(projectId, uid)
        const account = await getAccountByProject(projectId, uid)
        if (!account) { res.status(404).json({ error: "No WhatsApp account connected" }); return }
        // Mask the access token before returning
        res.json({ ...account, access_token: "••••••••" })
    } catch (err) { handleError(err, res, "Failed to load WhatsApp account") }
}

/** POST /api/campaigns/whatsapp/account */
export async function connectAccountController(req: Request, res: Response) {
    try {
        const uid = userId(req)
        const body = req.body as Partial<CreateAccountInput & { project_id: string }>
        const projectId = str(body.project_id)
        if (!projectId) { res.status(400).json({ error: "project_id required" }); return }
        await assertProjectAccess(projectId, uid)

        const wabaId = str(body.wabaId)
        const phoneNumberId = str(body.phoneNumberId)
        const displayPhone = str(body.displayPhone)
        const displayName = str(body.displayName)
        const accessToken = str(body.accessToken)

        if (!wabaId || !phoneNumberId || !displayPhone || !displayName || !accessToken) {
            res.status(400).json({ error: "wabaId, phoneNumberId, displayPhone, displayName, accessToken are required" })
            return
        }

        const existing = await getAccountByProject(projectId, uid)
        if (existing) { res.status(409).json({ error: "WhatsApp account already connected to this project" }); return }

        const account = await createAccount({ userId: uid, projectId, wabaId, phoneNumberId, displayPhone, displayName, accessToken })
        // Async health sync — don't await, returns fast
        void syncAccountHealth(account.id, accessToken, phoneNumberId)
        res.status(201).json({ ...account, access_token: "••••••••" })
    } catch (err) { handleError(err, res, "Failed to connect WhatsApp account") }
}

/** POST /api/campaigns/whatsapp/account/test — development-only Meta test sender */
export async function connectTestAccountController(req: Request, res: Response) {
    try {
        const uid = userId(req)
        const projectId = str(req.body?.project_id)
        const testAccount = getConfiguredWhatsAppTestAccount()
        if (!projectId) { res.status(400).json({ error: "project_id required" }); return }
        if (!testAccount) {
            res.status(503).json({ error: "Meta test sender is not configured on this environment" })
            return
        }
        await assertProjectAccess(projectId, uid)
        if (await getAccountByProject(projectId, uid)) {
            res.status(409).json({ error: "WhatsApp account already connected to this project" })
            return
        }
        const account = await createAccount({ userId: uid, projectId, ...testAccount })
        void syncAccountHealth(account.id, testAccount.accessToken, testAccount.phoneNumberId)
        res.status(201).json({ ...account, access_token: "••••••••" })
    } catch (err) { handleError(err, res, "Failed to connect Meta test sender") }
}

/** PATCH /api/campaigns/whatsapp/account/:accountId */
export async function updateAccountProfileController(req: Request, res: Response) {
    try {
        const { accountId } = req.params
        const uid = userId(req)
        const body = req.body as Record<string, unknown>

        // Find and verify ownership
        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } })
        if (!account) { res.status(404).json({ error: "Account not found" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        const profilePayload: Record<string, unknown> = {
            messaging_product: "whatsapp",
        }
        if (str(body.about)) profilePayload.about = str(body.about)
        if (str(body.address)) profilePayload.address = str(body.address)
        if (str(body.businessDescription)) profilePayload.description = str(body.businessDescription)
        if (str(body.website)) profilePayload.websites = [str(body.website)]
        if (str(body.businessCategory)) profilePayload.vertical = str(body.businessCategory)

        // Push to Meta
        await updateWhatsAppBusinessProfile(account.phone_number_id, accessTokenForAccount(account), profilePayload as any)

        // Persist locally
        const updated = await updateAccount(accountId, {
            about: str(body.about),
            business_category: str(body.businessCategory),
            business_description: str(body.businessDescription),
            website: str(body.website),
            address: str(body.address),
        })
        res.json({ ...updated, access_token: "••••••••" })
    } catch (err) { handleError(err, res, "Failed to update profile") }
}

/** POST /api/campaigns/whatsapp/account/:accountId/upload-profile-pic */
export async function uploadProfilePicController(req: Request, res: Response) {
    try {
        const { accountId } = req.params
        const uid = userId(req)

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } })
        if (!account) { res.status(404).json({ error: "Account not found" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        const appId = process.env.META_APP_ID
        if (!appId) { res.status(500).json({ error: "META_APP_ID not configured" }); return }

        // Expect: { fileBase64: string, fileName: string, fileType: string }
        const { fileBase64, fileName, fileType } = req.body as {
            fileBase64?: string
            fileName?: string
            fileType?: string
        }
        if (!fileBase64 || !fileName || !fileType) {
            res.status(400).json({ error: "fileBase64, fileName, fileType required" })
            return
        }

        const buffer = Buffer.from(fileBase64, "base64")

        // Step 1: Create upload session
        const session = await createProfilePicUploadSession(
            appId, accessTokenForAccount(account), buffer.length, fileType, fileName,
        )

        // Step 2: Upload binary
        const uploadResult = await uploadProfilePicBinary(
            session.id, accessTokenForAccount(account), buffer, fileType,
        )

        // Step 3: Apply handle to profile
        await applyProfilePicHandle(account.phone_number_id, accessTokenForAccount(account), uploadResult.h)

        // Persist handle + update profile url
        const updated = await updateAccount(accountId, {
            profile_pic_handle: uploadResult.h,
        })

        res.json({ success: true, handle: uploadResult.h, account: { ...updated, access_token: "••••••••" } })
    } catch (err) {
        console.error("[whatsapp] Profile pic upload failed:", describeMetaError(err))
        handleError(err, res, "Failed to upload profile picture")
    }
}

/** POST /api/campaigns/whatsapp/account/:accountId/sync */
export async function syncAccountController(req: Request, res: Response) {
    try {
        const { accountId } = req.params
        const uid = userId(req)

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } })
        if (!account) { res.status(404).json({ error: "Account not found" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        await syncAccountHealth(accountId, accessTokenForAccount(account), account.phone_number_id)
        const refreshed = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } })
        res.json({ ...refreshed, access_token: "••••••••" })
    } catch (err) { handleError(err, res, "Failed to sync account") }
}

/** GET /api/campaigns/whatsapp/account/:accountId/health */
export async function accountHealthController(req: Request, res: Response) {
    try {
        const { accountId } = req.params
        const uid = userId(req)
        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } })
        if (!account) { res.status(404).json({ error: "Account not found" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }
        res.json(await checkAccountHealth(account))
    } catch (err) { handleError(err, res, "Failed to check WhatsApp connection health") }
}

/** DELETE /api/campaigns/whatsapp/account/:accountId */
export async function disconnectAccountController(req: Request, res: Response) {
    try {
        const { accountId } = req.params
        const uid = userId(req)
        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } })
        if (!account) { res.status(404).json({ error: "Account not found" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }
        await deleteAccount(accountId)
        res.json({ success: true })
    } catch (err) { handleError(err, res, "Failed to disconnect account") }
}

// ─── Templates ────────────────────────────────────────────────────────────────

/** GET /api/campaigns/whatsapp/templates?account_id=xxx */
export async function listTemplatesController(req: Request, res: Response) {
    try {
        const accountId = str(req.query.account_id)
        if (!accountId) { res.status(400).json({ error: "account_id required" }); return }
        const templates = await listTemplates(accountId)
        res.json(templates)
    } catch (err) { handleError(err, res, "Failed to list templates") }
}

/** POST /api/campaigns/whatsapp/templates/sync */
export async function syncTemplatesController(req: Request, res: Response) {
    try {
        const accountId = str(req.body?.account_id)
        if (!accountId) { res.status(400).json({ error: "account_id required" }); return }
        const uid = userId(req)

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } })
        if (!account || account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        const templates = await syncTemplatesFromMeta(accountId, account.waba_id, accessTokenForAccount(account))
        res.json(templates)
    } catch (err) { handleError(err, res, "Failed to sync templates") }
}

/** POST /api/campaigns/whatsapp/templates */
export async function createTemplateController(req: Request, res: Response) {
    try {
        const uid = userId(req)
        const { accountId, name, language, category, components } = req.body as {
            accountId?: string
            name?: string
            language?: string
            category?: string
            components?: unknown[]
        }

        if (!accountId || !name || !language || !category || !components?.length) {
            res.status(400).json({ error: "accountId, name, language, category, components required" })
            return
        }

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId } })
        if (!account || account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        // Create locally first
        const localTemplate = await createLocalTemplate({
            accountId,
            name,
            language,
            category: category as any,
            components: components as any[],
        })

        // Submit to Meta
        try {
            const metaResult = await createMetaTemplate(account.waba_id, accessTokenForAccount(account), {
                name,
                language,
                category,
                components: components as any[],
            })

            const { markTemplateWithMetaId } = await import("./whatsapp_service")
            const updated = await markTemplateWithMetaId(localTemplate.id, metaResult.id, "PENDING")
            res.status(201).json(updated)
        } catch (metaErr) {
            // Return local template even if Meta submission failed
            res.status(201).json({ ...localTemplate, meta_error: describeMetaError(metaErr) })
        }
    } catch (err) { handleError(err, res, "Failed to create template") }
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

/** GET /api/campaigns/whatsapp?account_id=xxx */
export async function listCampaignsController(req: Request, res: Response) {
    try {
        const accountId = str(req.query.account_id)
        if (!accountId) { res.status(400).json({ error: "account_id required" }); return }
        const campaigns = await listCampaigns(accountId)
        res.json(campaigns)
    } catch (err) { handleError(err, res, "Failed to list campaigns") }
}

/** GET /api/campaigns/whatsapp/:campaignId */
export async function getCampaignController(req: Request, res: Response) {
    try {
        const campaign = await getCampaign(req.params.campaignId)
        if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return }
        res.json(campaign)
    } catch (err) { handleError(err, res, "Failed to get campaign") }
}

/** POST /api/campaigns/whatsapp */
export async function createCampaignController(req: Request, res: Response) {
    try {
        const uid = userId(req)
        const body = req.body as Partial<CreateCampaignInput & { accountId: string }>

        if (!body.accountId || !body.name || !body.recipients?.length) {
            res.status(400).json({ error: "accountId, name, and recipients[] required" })
            return
        }

        const campaign = await createCampaign({
            accountId: body.accountId,
            userId: uid,
            name: body.name,
            objective: body.objective,
            templateId: body.templateId,
            headerMediaUrl: body.headerMediaUrl,
            headerMediaType: body.headerMediaType,
            variableMapping: body.variableMapping,
            scheduledAt: body.scheduledAt,
            pacePerSecond: body.pacePerSecond,
            recipients: body.recipients,
        })
        res.status(201).json(campaign)
    } catch (err) { handleError(err, res, "Failed to create campaign") }
}

/** POST /api/campaigns/whatsapp/:campaignId/launch */
export async function launchCampaignController(req: Request, res: Response) {
    try {
        const { campaignId } = req.params
        const uid = userId(req)

        const campaign = await getCampaign(campaignId)
        if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return }
        if (campaign.account?.display_phone === undefined) {
            res.status(400).json({ error: "No WhatsApp account linked" })
            return
        }
        if (campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED") {
            res.status(400).json({ error: `Cannot launch campaign in status: ${campaign.status}` })
            return
        }
        if (!campaign.template_id || !campaign.template) {
            res.status(400).json({ error: "No template selected" })
            return
        }

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { id: campaign.account_id } })
        if (!account || account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        // Mark as RUNNING
        await updateCampaignStatus(campaignId, "RUNNING", { started_at: new Date() })

        // Return immediately — bulk dispatch runs in background
        res.json({ success: true, campaign_id: campaignId, status: "RUNNING" })

        // ── Background dispatch ────────────────────────────────────────────────
        void (async () => {
            try {
                const recipients = await prisma.whatsAppCampaignRecipient.findMany({
                    where: { campaign_id: campaignId, status: "QUEUED" },
                    orderBy: { created_at: "asc" },
                })

                const template = campaign.template!
                const components = (template.components as unknown as any[]) ?? []
                const variableMapping = (campaign.variable_mapping as Record<string, string>) ?? {}
                const pacePerSecond = campaign.pace_per_second ?? 10
                const delayMs = Math.floor(1000 / pacePerSecond)

                for (const recipient of recipients) {
                    try {
                        const recipientVars = (recipient.variables as Record<string, string>) ?? {}

                        // Build components with variable substitution
                        const filledComponents = buildTemplateComponents(
                            components, recipientVars, variableMapping, campaign.header_media_url,
                        )

                        const payload = {
                            messaging_product: "whatsapp" as const,
                            recipient_type: "individual" as const,
                            to: recipient.phone.replace(/\D/g, ""),
                            type: "template" as const,
                            template: {
                                name: template.name,
                                language: { code: template.language },
                                components: filledComponents,
                            },
                        }

                        const result = await sendWhatsAppTemplateMessage(
                            account.phone_number_id,
                            accessTokenForAccount(account),
                            payload,
                        )

                        const metaMsgId = result.messages?.[0]?.id
                        if (metaMsgId) {
                            await prisma.whatsAppCampaignRecipient.update({
                                where: { id: recipient.id },
                                data: { meta_msg_id: metaMsgId, status: "SENT", sent_at: new Date() },
                            })
                        }
                    } catch (sendErr) {
                        const msg = describeMetaError(sendErr)
                        await prisma.whatsAppCampaignRecipient.update({
                            where: { id: recipient.id },
                            data: { status: "FAILED", error_msg: msg.slice(0, 500) },
                        })
                    }

                    await sleep(delayMs)
                }

                await updateCampaignCounts(campaignId)
                await updateCampaignStatus(campaignId, "COMPLETED", { completed_at: new Date() })
            } catch (err) {
                const msg = err instanceof Error ? err.message : "Dispatch error"
                await updateCampaignStatus(campaignId, "FAILED", { error_message: msg })
            }
        })()
    } catch (err) { handleError(err, res, "Failed to launch campaign") }
}

/** PATCH /api/campaigns/whatsapp/:campaignId/pause */
export async function pauseCampaignController(req: Request, res: Response) {
    try {
        const campaign = await updateCampaignStatus(req.params.campaignId, "PAUSED")
        res.json(campaign)
    } catch (err) { handleError(err, res, "Failed to pause campaign") }
}

/** DELETE /api/campaigns/whatsapp/:campaignId */
export async function deleteCampaignController(req: Request, res: Response) {
    try {
        await deleteCampaign(req.params.campaignId)
        res.json({ success: true })
    } catch (err) { handleError(err, res, "Failed to delete campaign") }
}

/** GET /api/campaigns/whatsapp/:campaignId/recipients */
export async function listRecipientsController(req: Request, res: Response) {
    try {
        const page = num(req.query.page, 1)
        const limit = num(req.query.limit, 50)
        const data = await listCampaignRecipients(req.params.campaignId, page, limit)
        res.json(data)
    } catch (err) { handleError(err, res, "Failed to list recipients") }
}

/** POST /api/campaigns/whatsapp/cost-estimate */
export async function costEstimateController(req: Request, res: Response) {
    try {
        const { recipients, category } = req.body as { recipients?: number; category?: string }
        if (!recipients || !category) {
            res.status(400).json({ error: "recipients and category required" })
            return
        }
        const estimate = calculateCampaignCost(Number(recipients), category as any)
        res.json(estimate)
    } catch (err) { handleError(err, res, "Failed to calculate cost") }
}

// ─── Webhook ─────────────────────────────────────────────────────────────────

/** POST /api/campaigns/whatsapp/webhook */
export async function webhookController(req: Request, res: Response) {
    console.log(`[WhatsApp Webhook ${req.method}] received:`, JSON.stringify(req.method === "GET" ? req.query : req.body, null, 2))

    // Meta webhook verification (GET)
    if (req.method === "GET") {
        const mode = req.query["hub.mode"]
        const token = req.query["hub.verify_token"]
        const challenge = req.query["hub.challenge"]
        if (mode === "subscribe" && getWebhookVerifyToken() && token === getWebhookVerifyToken()) {
            console.log("[WhatsApp Webhook] Verification successful. Challenge sent:", challenge)
            res.status(200).send(challenge)
        } else {
            console.warn("[WhatsApp Webhook] Verification failed. Token mismatch or bad mode:", { token, expected: getWebhookVerifyToken(), mode })
            res.status(403).send("Forbidden")
        }
        return
    }

    if (!verifyMetaWebhookSignature(req)) {
        console.warn("[WhatsApp Webhook] Invalid webhook signature")
        res.status(403).json({ error: "Invalid webhook signature" })
        return
    }

    // POST: Process webhook events
    const payload = req.body as MetaWebhookPayload
    res.status(200).json({ ok: true }) // Always ack fast

    // Process async
    void (async () => {
        try {
            for (const entry of payload.entry ?? []) {
                for (const change of entry.changes ?? []) {
                    const value = change.value
                    if (!value) continue

                    // 1. Process delivery status updates
                    for (const status of value.statuses ?? []) {
                        const wamid = status.id
                        const ts = new Date(Number(status.timestamp) * 1000)

                        const timestampMap: Record<string, Record<string, Date>> = {
                            sent: { sent_at: ts },
                            delivered: { delivered_at: ts },
                            read: { read_at: ts },
                        }

                        const errorInfo = status.errors?.[0]
                            ? { code: String(status.errors[0].code), msg: status.errors[0].message ?? status.errors[0].title }
                            : undefined

                        await updateRecipientStatus(
                            wamid,
                            status.status.toUpperCase(),
                            timestampMap[status.status] ?? {},
                            errorInfo,
                        )
                        logWhatsAppEvent(status.status === "failed" ? "error" : "info", "message_status_update", {
                            phoneNumberId: value.metadata?.phone_number_id,
                            messageId: wamid,
                            status: status.status,
                            errorCode: errorInfo?.code,
                            errorMessage: errorInfo?.msg,
                        })

                        // Update campaign aggregate counts
                        const { default: prisma } = await import("../../../lib/prisma")
                        const recipient = await prisma.whatsAppCampaignRecipient.findFirst({
                            where: { meta_msg_id: wamid },
                            select: { campaign_id: true },
                        })
                        if (recipient) {
                            await updateCampaignCounts(recipient.campaign_id)
                        }
                    }

                    // 2. Process inbound user messages (Chatbot / Appointment Booking)
                    const incomingMessages = (value as any).messages ?? []
                    for (const msg of incomingMessages) {
                        const fromPhone = msg.from
                        const text = msg.text?.body
                        let interactiveType: string | undefined
                        let interactiveId: string | undefined
                        let interactiveTitle: string | undefined

                        if (msg.type === "interactive") {
                            if (msg.interactive?.type === "button_reply") {
                                interactiveType = "button_reply"
                                interactiveId = msg.interactive.button_reply?.id
                                interactiveTitle = msg.interactive.button_reply?.title
                            } else if (msg.interactive?.type === "list_reply") {
                                interactiveType = "list_reply"
                                interactiveId = msg.interactive.list_reply?.id
                                interactiveTitle = msg.interactive.list_reply?.title
                            }
                        }

                        const phoneNumberId = value.metadata?.phone_number_id
                        if (phoneNumberId && fromPhone) {
                            logWhatsAppEvent("info", "inbound_message_received", {
                                phoneNumberId,
                                direction: "inbound",
                                recipient: fromPhone,
                                messageType: msg.type,
                                messageId: msg.id,
                            })
                            const { processInboundWhatsAppMessage } = await import("./whatsapp_bot_service")
                            await processInboundWhatsAppMessage(phoneNumberId, {
                                fromPhone,
                                text,
                                interactiveType,
                                interactiveId,
                                interactiveTitle,
                            })
                        }
                    }
                }
            }
        } catch (err) {
            logWhatsAppEvent("error", "webhook_processing_failed", {
                errorMessage: err instanceof Error ? err.message : String(err),
            })
        }
    })()
}

// ─── Bot Config & Leads Handlers ──────────────────────────────────────────────

/** GET /api/campaigns/whatsapp/bot-config?project_id=... */
export async function getBotConfigController(req: Request, res: Response) {
    try {
        const uid = userId(req)
        if (!uid) { res.status(401).json({ error: "Unauthorized" }); return }
        const projectId = req.query.project_id as string
        if (!projectId) { res.status(400).json({ error: "Missing project_id" }); return }

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { project_id: projectId } })
        if (!account) { res.status(404).json({ error: "WhatsApp account not connected for this project" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        const { getOrCreateBotConfig } = await import("./whatsapp_bot_service")
        const config = await getOrCreateBotConfig(account.id)
        res.json({ config })
    } catch (err) {
        console.error("[whatsapp] getBotConfigController error:", err)
        res.status(500).json({ error: "Failed to fetch bot config" })
    }
}

/** PUT /api/campaigns/whatsapp/bot-config */
export async function updateBotConfigController(req: Request, res: Response) {
    try {
        const uid = userId(req)
        if (!uid) { res.status(401).json({ error: "Unauthorized" }); return }
        const { project_id, ...data } = req.body
        if (!project_id) { res.status(400).json({ error: "Missing project_id" }); return }

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { project_id } })
        if (!account) { res.status(404).json({ error: "WhatsApp account not connected for this project" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        const { updateBotConfig } = await import("./whatsapp_bot_service")
        const updated = await updateBotConfig(account.id, data)
        res.json({ success: true, config: updated })
    } catch (err) {
        console.error("[whatsapp] updateBotConfigController error:", err)
        res.status(500).json({ error: "Failed to update bot config" })
    }
}

/** GET /api/campaigns/whatsapp/leads?project_id=...&status=... */
export async function getLeadsController(req: Request, res: Response) {
    try {
        const uid = userId(req)
        if (!uid) { res.status(401).json({ error: "Unauthorized" }); return }
        const projectId = req.query.project_id as string
        const status = req.query.status as string | undefined
        if (!projectId) { res.status(400).json({ error: "Missing project_id" }); return }

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { project_id: projectId } })
        if (!account) { res.status(404).json({ error: "WhatsApp account not connected for this project" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        const { listLeads } = await import("./whatsapp_bot_service")
        const leads = await listLeads(account.id, { status })
        res.json({ leads })
    } catch (err) {
        console.error("[whatsapp] getLeadsController error:", err)
        res.status(500).json({ error: "Failed to fetch leads" })
    }
}

/** PATCH /api/campaigns/whatsapp/leads/:id */
export async function updateLeadController(req: Request, res: Response) {
    try {
        const uid = userId(req)
        if (!uid) { res.status(401).json({ error: "Unauthorized" }); return }
        const leadId = req.params.id
        const { project_id, status, staff_notes } = req.body
        if (!project_id) { res.status(400).json({ error: "Missing project_id" }); return }

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { project_id } })
        if (!account) { res.status(404).json({ error: "WhatsApp account not found" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        const { updateLeadStatus } = await import("./whatsapp_bot_service")
        await updateLeadStatus(leadId, account.id, { status, staff_notes })
        res.json({ success: true })
    } catch (err) {
        console.error("[whatsapp] updateLeadController error:", err)
        res.status(500).json({ error: "Failed to update lead" })
    }
}

/** DELETE /api/campaigns/whatsapp/leads/:id */
export async function deleteLeadController(req: Request, res: Response) {
    try {
        const uid = userId(req)
        if (!uid) { res.status(401).json({ error: "Unauthorized" }); return }
        const leadId = req.params.id
        const projectId = req.query.project_id as string
        if (!projectId) { res.status(400).json({ error: "Missing project_id" }); return }

        const { default: prisma } = await import("../../../lib/prisma")
        const account = await prisma.whatsAppAccount.findUnique({ where: { project_id: projectId } })
        if (!account) { res.status(404).json({ error: "WhatsApp account not found" }); return }
        if (account.user_id !== uid) { res.status(403).json({ error: "Forbidden" }); return }

        const { deleteLead } = await import("./whatsapp_bot_service")
        await deleteLead(leadId, account.id)
        res.json({ success: true })
    } catch (err) {
        console.error("[whatsapp] deleteLeadController error:", err)
        res.status(500).json({ error: "Failed to delete lead" })
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildTemplateComponents(
    components: any[],
    recipientVars: Record<string, string>,
    variableMapping: Record<string, string>,
    headerMediaUrl?: string | null,
): any[] {
    const result: any[] = []

    for (const comp of components) {
        if (comp.type === "HEADER") {
            if (comp.format === "IMAGE" && headerMediaUrl) {
                result.push({
                    type: "header",
                    parameters: [{ type: "image", image: { link: headerMediaUrl } }],
                })
            } else if (comp.format === "TEXT") {
                const bodyParams = extractParams(comp.text ?? "", recipientVars, variableMapping)
                if (bodyParams.length > 0) {
                    result.push({ type: "header", parameters: bodyParams })
                }
            }
        } else if (comp.type === "BODY") {
            const bodyParams = extractParams(comp.text ?? "", recipientVars, variableMapping)
            if (bodyParams.length > 0) {
                result.push({ type: "body", parameters: bodyParams })
            }
        } else if (comp.type === "BUTTONS") {
            for (let i = 0; i < (comp.buttons ?? []).length; i++) {
                const btn = comp.buttons[i]
                if (btn.type === "URL" && btn.url?.includes("{{")) {
                    result.push({
                        type: "button",
                        sub_type: "url",
                        index: String(i),
                        parameters: [{ type: "text", text: recipientVars.tracking_id ?? "" }],
                    })
                }
            }
        }
    }

    return result
}

function extractParams(
    text: string,
    recipientVars: Record<string, string>,
    mapping: Record<string, string>,
): Array<{ type: "text"; text: string }> {
    const params: Array<{ type: "text"; text: string }> = []
    const placeholders = text.match(/\{\{(\d+)\}\}/g) ?? []
    for (const ph of placeholders) {
        const idx = ph.replace(/\{\{|\}\}/g, "")
        const csvCol = mapping[idx]
        const value = csvCol ? (recipientVars[csvCol] ?? "") : ""
        params.push({ type: "text", text: value })
    }
    return params
}
