import { Prisma } from "@prisma/client"
import prisma from "../../../lib/prisma"
import {
    fetchMetaTemplates,
    fetchPhoneNumberDetails,
    fetchWhatsAppBusinessProfile,
    describeMetaError,
} from "./whatsapp_meta_api"
import type {
    CreateAccountInput,
    UpdateAccountProfileInput,
    CreateTemplateInput,
    CreateCampaignInput,
    CampaignRecipientInput,
    WhatsAppCampaignStatus,
    calculateCampaignCost,
} from "./whatsapp_types"
import { WHATSAPP_RATES_INR, GST_RATE } from "./whatsapp_types"
import { encryptWhatsAppToken, getWhatsAppAccessToken, isEncryptedWhatsAppToken } from "./whatsapp_security"
import { logWhatsAppEvent } from "./whatsapp_logger"
import { getWebhookHealth } from "./whatsapp_config"

// ─── Account CRUD ─────────────────────────────────────────────────────────────

export async function getAccountByProject(projectId: string, userId: string) {
    return prisma.whatsAppAccount.findUnique({
        where: { project_id: projectId },
    })
}

export async function createAccount(input: CreateAccountInput) {
    return prisma.whatsAppAccount.create({
        data: {
            user_id: input.userId,
            project_id: input.projectId,
            waba_id: input.wabaId,
            phone_number_id: input.phoneNumberId,
            display_phone: input.displayPhone,
            display_name: input.displayName,
            access_token: encryptWhatsAppToken(input.accessToken),
        },
    })
}

export function accessTokenForAccount(account: { id: string; access_token: string }): string {
    const token = getWhatsAppAccessToken(account)
    if (!isEncryptedWhatsAppToken(account.access_token)) {
        logWhatsAppEvent("warn", "legacy_plaintext_token_detected", { accountId: account.id })
    }
    return token
}

export async function updateAccount(
    accountId: string,
    data: Partial<{
        display_name: string
        about: string
        business_category: string
        business_description: string
        website: string
        address: string
        profile_pic_url: string
        profile_pic_handle: string
        quality_rating: string
        messaging_limit: number
        is_green_badge: boolean
    }>,
) {
    return prisma.whatsAppAccount.update({
        where: { id: accountId },
        data,
    })
}

export async function deleteAccount(accountId: string) {
    return prisma.whatsAppAccount.delete({ where: { id: accountId } })
}

// ─── Sync phone number quality & tier from Meta ───────────────────────────────

export async function syncAccountHealth(accountId: string, accessToken: string, phoneNumberId: string) {
    try {
        const details = await fetchPhoneNumberDetails(phoneNumberId, accessToken)
        const qualityMap: Record<string, string> = {
            GREEN: "HIGH",
            YELLOW: "MEDIUM",
            RED: "LOW",
        }
        const tierLimitMap: Record<string, number> = {
            TIER_NOT_SET: 250,
            TIER_1K: 1000,
            TIER_10K: 10000,
            TIER_100K: 100000,
            UNLIMITED: 9999999,
        }
        await prisma.whatsAppAccount.update({
            where: { id: accountId },
            data: {
                quality_rating: (qualityMap[details.quality_rating] ?? "UNKNOWN") as any,
                messaging_limit: tierLimitMap[details.messaging_limit_tier] ?? 1000,
                is_green_badge: !!details.is_official_business_account,
            },
        })
    } catch (err) {
        console.error("[whatsapp] Failed to sync account health:", describeMetaError(err))
    }
}

export async function checkAccountHealth(account: {
    id: string
    phone_number_id: string
    access_token: string
}) {
    const startedAt = Date.now()
    const webhook = getWebhookHealth()
    const token = accessTokenForAccount(account)
    const result: {
        status: "healthy" | "degraded" | "unhealthy"
        checkedAt: string
        durationMs: number
        credentials: { status: "healthy" | "unhealthy"; message: string }
        phone: { status: "healthy" | "unhealthy"; displayPhone?: string; verifiedName?: string; qualityRating?: string; message?: string }
        profile: { status: "healthy" | "unhealthy"; message: string }
        webhook: { status: "healthy" | "unhealthy"; configured: boolean; url: string | null; message?: string }
    } = {
        status: "healthy",
        checkedAt: new Date().toISOString(),
        durationMs: 0,
        credentials: { status: "healthy", message: "Meta credentials accepted" },
        phone: { status: "healthy" },
        profile: { status: "healthy", message: "Business profile reachable" },
        webhook: {
            status: webhook.configured ? "healthy" : "unhealthy",
            configured: webhook.configured,
            url: webhook.url,
            message: webhook.reason,
        },
    }

    try {
        const [phone, profile] = await Promise.all([
            fetchPhoneNumberDetails(account.phone_number_id, token),
            fetchWhatsAppBusinessProfile(account.phone_number_id, token),
        ])
        result.phone = {
            status: "healthy",
            displayPhone: phone.display_phone_number,
            verifiedName: phone.verified_name,
            qualityRating: phone.quality_rating,
        }
        result.profile = { status: "healthy", message: "Business profile reachable" }
        logWhatsAppEvent("info", "account_health_check", {
            accountId: account.id,
            phoneNumberId: account.phone_number_id,
            durationMs: Date.now() - startedAt,
            status: result.status,
        })
    } catch (error) {
        const message = describeMetaError(error)
        result.status = "unhealthy"
        result.credentials = { status: "unhealthy", message }
        result.phone = { status: "unhealthy", message }
        result.profile = { status: "unhealthy", message }
        logWhatsAppEvent("error", "account_health_check_failed", {
            accountId: account.id,
            phoneNumberId: account.phone_number_id,
            durationMs: Date.now() - startedAt,
            errorMessage: message,
        })
    }

    if (!webhook.configured && result.status === "healthy") result.status = "degraded"
    result.durationMs = Date.now() - startedAt
    return result
}

// ─── Templates ────────────────────────────────────────────────────────────────

export async function listTemplates(accountId: string) {
    return prisma.whatsAppTemplate.findMany({
        where: { account_id: accountId },
        orderBy: [{ status: "asc" }, { created_at: "desc" }],
    })
}

export async function syncTemplatesFromMeta(accountId: string, wabaId: string, accessToken: string) {
    const metaTemplates = await fetchMetaTemplates(wabaId, accessToken)

    const statusMap: Record<string, string> = {
        APPROVED: "APPROVED",
        PENDING: "PENDING",
        REJECTED: "REJECTED",
        PAUSED: "PAUSED",
        DISABLED: "DISABLED",
    }
    const categoryMap: Record<string, string> = {
        MARKETING: "MARKETING",
        UTILITY: "UTILITY",
        AUTHENTICATION: "AUTHENTICATION",
    }

    for (const t of metaTemplates) {
        await prisma.whatsAppTemplate.upsert({
            where: {
                account_id_name_language: {
                    account_id: accountId,
                    name: t.name,
                    language: t.language,
                },
            },
            create: {
                account_id: accountId,
                meta_id: t.id,
                name: t.name,
                language: t.language,
                category: (categoryMap[t.category] ?? "MARKETING") as any,
                status: (statusMap[t.status] ?? "PENDING") as any,
                components: t.components as Prisma.InputJsonValue,
            },
            update: {
                meta_id: t.id,
                status: (statusMap[t.status] ?? "PENDING") as any,
                components: t.components as Prisma.InputJsonValue,
            },
        })
    }

    return prisma.whatsAppTemplate.findMany({
        where: { account_id: accountId },
        orderBy: [{ status: "asc" }, { name: "asc" }],
    })
}

export async function createLocalTemplate(input: CreateTemplateInput) {
    return prisma.whatsAppTemplate.create({
        data: {
            account_id: input.accountId,
            name: input.name,
            language: input.language,
            category: input.category,
            components: input.components as Prisma.InputJsonValue,
            status: "PENDING",
        },
    })
}

export async function markTemplateWithMetaId(templateId: string, metaId: string, status: string) {
    return prisma.whatsAppTemplate.update({
        where: { id: templateId },
        data: { meta_id: metaId, status: status as any },
    })
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export async function listCampaigns(accountId: string) {
    return prisma.whatsAppCampaign.findMany({
        where: { account_id: accountId },
        orderBy: { created_at: "desc" },
        include: {
            template: { select: { name: true, category: true, language: true } },
        },
        take: 50,
    })
}

export async function getCampaign(campaignId: string) {
    return prisma.whatsAppCampaign.findUnique({
        where: { id: campaignId },
        include: {
            template: true,
            account: { select: { display_phone: true, display_name: true } },
        },
    })
}

export async function createCampaign(input: CreateCampaignInput) {
    const recipientCount = input.recipients.length

    // Calculate cost estimate
    let estimatedCost: number | undefined
    if (input.templateId) {
        const template = await prisma.whatsAppTemplate.findUnique({
            where: { id: input.templateId },
            select: { category: true },
        })
        if (template) {
            const rate = WHATSAPP_RATES_INR[template.category as keyof typeof WHATSAPP_RATES_INR] ?? WHATSAPP_RATES_INR.MARKETING
            const subtotal = recipientCount * rate
            estimatedCost = Math.round((subtotal + subtotal * GST_RATE) * 100) / 100
        }
    }

    return prisma.$transaction(async (tx) => {
        const campaign = await tx.whatsAppCampaign.create({
            data: {
                account_id: input.accountId,
                user_id: input.userId,
                name: input.name,
                objective: input.objective,
                template_id: input.templateId,
                header_media_url: input.headerMediaUrl,
                header_media_type: input.headerMediaType,
                variable_mapping: input.variableMapping as Prisma.InputJsonValue ?? undefined,
                total_recipients: recipientCount,
                estimated_cost_inr: estimatedCost,
                pace_per_second: input.pacePerSecond ?? 10,
                scheduled_at: input.scheduledAt ? new Date(input.scheduledAt) : null,
                status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
            },
        })

        if (input.recipients.length > 0) {
            await tx.whatsAppCampaignRecipient.createMany({
                data: input.recipients.map((r) => ({
                    campaign_id: campaign.id,
                    phone: r.phone,
                    name: r.name,
                    variables: r.variables as Prisma.InputJsonValue ?? undefined,
                    status: "QUEUED",
                })),
            })
        }

        return campaign
    })
}

export async function updateCampaignStatus(
    campaignId: string,
    status: WhatsAppCampaignStatus,
    extra?: {
        started_at?: Date
        completed_at?: Date
        error_message?: string
    },
) {
    return prisma.whatsAppCampaign.update({
        where: { id: campaignId },
        data: { status: status as any, ...extra },
    })
}

export async function updateCampaignCounts(campaignId: string) {
    const counts = await prisma.whatsAppCampaignRecipient.groupBy({
        by: ["status"],
        where: { campaign_id: campaignId },
        _count: true,
    })
    const tally: Record<string, number> = {}
    for (const row of counts) {
        tally[row.status] = row._count
    }
    return prisma.whatsAppCampaign.update({
        where: { id: campaignId },
        data: {
            sent_count: (tally.SENT ?? 0) + (tally.DELIVERED ?? 0) + (tally.READ ?? 0),
            delivered_count: (tally.DELIVERED ?? 0) + (tally.READ ?? 0),
            read_count: tally.READ ?? 0,
            failed_count: tally.FAILED ?? 0,
        },
    })
}

export async function deleteCampaign(campaignId: string) {
    return prisma.whatsAppCampaign.delete({ where: { id: campaignId } })
}

// ─── Campaign Recipients ──────────────────────────────────────────────────────

export async function listCampaignRecipients(
    campaignId: string,
    page = 1,
    limit = 50,
) {
    const skip = (page - 1) * limit
    const [total, recipients] = await Promise.all([
        prisma.whatsAppCampaignRecipient.count({ where: { campaign_id: campaignId } }),
        prisma.whatsAppCampaignRecipient.findMany({
            where: { campaign_id: campaignId },
            orderBy: { created_at: "asc" },
            skip,
            take: limit,
        }),
    ])
    return { total, page, limit, recipients }
}

export async function updateRecipientStatus(
    metaMsgId: string,
    status: string,
    timestamps: {
        sent_at?: Date
        delivered_at?: Date
        read_at?: Date
    },
    error?: { code?: string; msg?: string },
) {
    return prisma.whatsAppCampaignRecipient.updateMany({
        where: { meta_msg_id: metaMsgId },
        data: {
            status: status as any,
            ...timestamps,
            error_code: error?.code,
            error_msg: error?.msg,
        },
    })
}

export async function setRecipientMetaMsgId(recipientId: string, metaMsgId: string) {
    return prisma.whatsAppCampaignRecipient.update({
        where: { id: recipientId },
        data: { meta_msg_id: metaMsgId, status: "SENT", sent_at: new Date() },
    })
}

export async function markRecipientFailed(
    recipientId: string,
    errorCode?: string,
    errorMsg?: string,
) {
    return prisma.whatsAppCampaignRecipient.update({
        where: { id: recipientId },
        data: { status: "FAILED", error_code: errorCode, error_msg: errorMsg },
    })
}
