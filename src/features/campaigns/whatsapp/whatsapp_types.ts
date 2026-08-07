// ─── WhatsApp Campaign Types ──────────────────────────────────────────────────

export type WhatsAppQualityRating = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"
export type WhatsAppCampaignStatus = "DRAFT" | "SCHEDULED" | "RUNNING" | "COMPLETED" | "PAUSED" | "FAILED"
export type WhatsAppTemplateStatus = "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED"
export type WhatsAppTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION"
export type MetaTemplateCategory = WhatsAppTemplateCategory
export type WhatsAppRecipientStatus = "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED"

// ─── Meta API Webhook ─────────────────────────────────────────────────────────

export interface MetaWebhookPayload {
    object: "whatsapp_business_account"
    entry: MetaWebhookEntry[]
}

export interface MetaWebhookEntry {
    id: string
    changes: MetaWebhookChange[]
}

export interface MetaWebhookChange {
    value: MetaWebhookValue
    field: string
}

export interface MetaWebhookValue {
    messaging_product: "whatsapp"
    metadata: {
        display_phone_number: string
        phone_number_id: string
    }
    statuses?: MetaMessageStatus[]
    messages?: MetaIncomingMessage[]
}

export interface MetaMessageStatus {
    id: string          // wamid
    status: "sent" | "delivered" | "read" | "failed"
    timestamp: string
    recipient_id: string
    errors?: MetaApiError[]
    conversation?: {
        id: string
        expiration_timestamp?: string
        origin?: { type: string }
    }
}

export interface MetaIncomingMessage {
    from: string
    id: string
    timestamp: string
    type: string
    text?: { body: string }
}

export interface MetaApiError {
    code: number
    title: string
    message?: string
    error_data?: { details: string }
}

// ─── Meta API: Send Template Message ─────────────────────────────────────────

export interface MetaTemplateComponent {
    type: "header" | "body" | "button"
    sub_type?: "url" | "quick_reply"
    index?: string
    parameters: MetaTemplateParameter[]
}

export interface MetaTemplateParameter {
    type: "text" | "image" | "document" | "video" | "currency" | "date_time"
    text?: string
    image?: { link: string }
    document?: { link: string; filename?: string }
    video?: { link: string }
}

export interface MetaSendMessagePayload {
    messaging_product: "whatsapp"
    recipient_type: "individual"
    to: string
    type: "template"
    template: {
        name: string
        language: { code: string }
        components?: MetaTemplateComponent[]
    }
}

export interface MetaSendMessageResponse {
    messages: Array<{ id: string }>
    contacts: Array<{ input: string; wa_id: string }>
    messaging_product: "whatsapp"
}

// ─── Meta API: Template Management ───────────────────────────────────────────

export interface MetaTemplateComponent_Schema {
    type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS"
    format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT"
    text?: string
    buttons?: Array<{
        type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER"
        text: string
        url?: string
        phone_number?: string
    }>
    example?: {
        header_handle?: string[]
        body_text?: string[][]
    }
}

export interface MetaTemplateFromApi {
    id: string
    name: string
    language: string
    category: string
    status: string
    components: MetaTemplateComponent_Schema[]
}

// ─── Meta API: Business Profile ───────────────────────────────────────────────

export interface MetaBusinessProfileUpdatePayload {
    messaging_product: "whatsapp"
    profile_picture_handle?: string
    about?: string
    address?: string
    description?: string
    email?: string
    websites?: string[]
    vertical?: string
}

// ─── Service Input/Output Types ───────────────────────────────────────────────

export interface CreateAccountInput {
    userId: string
    projectId: string
    wabaId: string
    phoneNumberId: string
    displayPhone: string
    displayName: string
    accessToken: string
}

export interface UpdateAccountProfileInput {
    accountId: string
    userId: string
    about?: string
    businessCategory?: string
    businessDescription?: string
    website?: string
    address?: string
}

export interface CreateTemplateInput {
    accountId: string
    name: string
    language: string
    category: WhatsAppTemplateCategory
    components: MetaTemplateComponent_Schema[]
}

export interface CreateCampaignInput {
    accountId: string
    userId: string
    name: string
    objective?: string
    templateId?: string
    headerMediaUrl?: string
    headerMediaType?: string
    variableMapping?: Record<string, string>
    scheduledAt?: string
    pacePerSecond?: number
    recipients: CampaignRecipientInput[]
}

export interface CampaignRecipientInput {
    phone: string
    name?: string
    variables?: Record<string, string>
}

export interface CampaignCostEstimate {
    recipients: number
    category: WhatsAppTemplateCategory
    ratePerMsg: number        // ₹ before GST
    subtotal: number          // ₹ before GST
    gstAmount: number         // 18% GST
    totalInr: number          // Final ₹ with GST
}

// ─── Cost Config (India 2026 per-message pricing) ────────────────────────────

export const WHATSAPP_RATES_INR: Record<WhatsAppTemplateCategory, number> = {
    MARKETING: 0.87,
    UTILITY: 0.12,
    AUTHENTICATION: 0.12,
}

export const GST_RATE = 0.18

export function calculateCampaignCost(
    recipients: number,
    category: WhatsAppTemplateCategory,
): CampaignCostEstimate {
    const ratePerMsg = WHATSAPP_RATES_INR[category]
    const subtotal = Math.round(recipients * ratePerMsg * 100) / 100
    const gstAmount = Math.round(subtotal * GST_RATE * 100) / 100
    const totalInr = Math.round((subtotal + gstAmount) * 100) / 100
    return { recipients, category, ratePerMsg, subtotal, gstAmount, totalInr }
}
