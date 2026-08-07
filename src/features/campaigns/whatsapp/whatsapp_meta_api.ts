import axios from "axios"
import type {
    MetaBusinessProfileUpdatePayload,
    MetaSendMessagePayload,
    MetaSendMessageResponse,
    MetaTemplateComponent_Schema,
    MetaTemplateFromApi,
    MetaTemplateCategory,
} from "./whatsapp_types"
import { getMetaGraphApiBase } from "./whatsapp_config"
import { logWhatsAppEvent } from "./whatsapp_logger"

const META_GRAPH_API_BASE = getMetaGraphApiBase()

// ─── Meta API Client factory ─────────────────────────────────────────────────

function metaClient(accessToken: string) {
    const client = axios.create({
        baseURL: META_GRAPH_API_BASE,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        timeout: 30000,
    })

    client.interceptors.response.use(
        (response) => {
            logWhatsAppEvent("info", "meta_api_response", {
                method: response.config.method?.toUpperCase(),
                path: response.config.url,
                status: response.status,
            })
            return response
        },
        (error) => {
            logWhatsAppEvent("error", "meta_api_error", {
                method: error.config?.method?.toUpperCase(),
                path: error.config?.url,
                status: error.response?.status,
                errorCode: error.response?.data?.error?.code ? String(error.response.data.error.code) : undefined,
                errorMessage: error.response?.data?.error?.message ?? error.message,
            })
            return Promise.reject(error)
        },
    )
    return client
}

// ─── Send a single template message ─────────────────────────────────────────

export async function sendWhatsAppTemplateMessage(
    phoneNumberId: string,
    accessToken: string,
    payload: MetaSendMessagePayload,
): Promise<MetaSendMessageResponse> {
    const client = metaClient(accessToken)
    const { data } = await client.post<MetaSendMessageResponse>(
        `/${phoneNumberId}/messages`,
        payload,
    )
    return data
}

// ─── Get all templates for WABA ──────────────────────────────────────────────

export async function fetchMetaTemplates(
    wabaId: string,
    accessToken: string,
): Promise<MetaTemplateFromApi[]> {
    const client = metaClient(accessToken)
    const { data } = await client.get<{
        data: MetaTemplateFromApi[]
        paging?: { cursors: { after: string; before: string } }
    }>(`/${wabaId}/message_templates`, {
        params: {
            fields: "id,name,language,category,status,components",
            limit: 200,
        },
    })
    return data.data
}

// ─── Create a template on Meta ───────────────────────────────────────────────

export async function createMetaTemplate(
    wabaId: string,
    accessToken: string,
    input: {
        name: string
        language: string
        category: string
        components: MetaTemplateComponent_Schema[]
    },
): Promise<{ id: string }> {
    const client = metaClient(accessToken)
    const { data } = await client.post<{ id: string }>(
        `/${wabaId}/message_templates`,
        {
            name: input.name,
            language: input.language,
            category: input.category,
            components: input.components,
        },
    )
    return data
}

// ─── Get business profile ────────────────────────────────────────────────────

export async function fetchWhatsAppBusinessProfile(
    phoneNumberId: string,
    accessToken: string,
) {
    const client = metaClient(accessToken)
    const { data } = await client.get(`/${phoneNumberId}/whatsapp_business_profile`, {
        params: {
            fields: "about,address,description,email,profile_picture_url,websites,vertical,messaging_product",
        },
    })
    return data
}

// ─── Update business profile (text fields) ──────────────────────────────────

export async function updateWhatsAppBusinessProfile(
    phoneNumberId: string,
    accessToken: string,
    payload: MetaBusinessProfileUpdatePayload,
): Promise<{ success: boolean }> {
    const client = metaClient(accessToken)
    const { data } = await client.post<{ success: boolean }>(
        `/${phoneNumberId}/whatsapp_business_profile`,
        payload,
    )
    return data
}

// ─── Resumable upload: Step 1 — create upload session ────────────────────────

export async function createProfilePicUploadSession(
    appId: string,
    accessToken: string,
    fileLength: number,
    fileType: string,
    fileName: string,
): Promise<{ id: string }> {
    const client = metaClient(accessToken)
    const { data } = await client.post<{ id: string }>(
        `/${appId}/uploads`,
        null,
        {
            params: {
                file_length: fileLength,
                file_type: fileType,
                file_name: fileName,
            },
        },
    )
    return data
}

// ─── Resumable upload: Step 2 — upload binary and get handle ─────────────────

export async function uploadProfilePicBinary(
    uploadSessionId: string,
    accessToken: string,
    binaryBuffer: Buffer,
    fileType: string,
): Promise<{ h: string }> {
    const { data } = await axios.post<{ h: string }>(
        `${getMetaGraphApiBase()}/${uploadSessionId}`,
        binaryBuffer,
        {
            headers: {
                Authorization: `OAuth ${accessToken}`,
                file_offset: "0",
                "Content-Type": fileType,
            },
            timeout: 60000,
        },
    )
    return data
}

// ─── Resumable upload: Step 3 — apply handle to profile ─────────────────────

export async function applyProfilePicHandle(
    phoneNumberId: string,
    accessToken: string,
    handle: string,
): Promise<{ success: boolean }> {
    const client = metaClient(accessToken)
    const { data } = await client.post<{ success: boolean }>(
        `/${phoneNumberId}/whatsapp_business_profile`,
        {
            messaging_product: "whatsapp",
            profile_picture_handle: handle,
        },
    )
    return data
}

// ─── Get phone number quality & tier ─────────────────────────────────────────

export async function fetchPhoneNumberDetails(
    phoneNumberId: string,
    accessToken: string,
) {
    const client = metaClient(accessToken)
    const { data } = await client.get(`/${phoneNumberId}`, {
        params: {
            fields: "display_phone_number,verified_name,quality_rating,messaging_limit_tier,is_official_business_account,code_verification_status",
        },
    })
    return data
}

// ─── Send freeform text message (within 24h window) ──────────────────────────

export async function sendWhatsAppTextMessage(
    phoneNumberId: string,
    accessToken: string,
    toPhone: string,
    text: string,
): Promise<MetaSendMessageResponse> {
    const client = metaClient(accessToken)
    const recipientPhone = toPhone.replace(/\+/g, "").trim()
    const { data } = await client.post<MetaSendMessageResponse>(
        `/${phoneNumberId}/messages`,
        {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientPhone,
            type: "text",
            text: { preview_url: false, body: text },
        },
    )
    return data
}

// ─── Send interactive quick-reply buttons ───────────────────────────────────

export async function sendWhatsAppInteractiveButtons(
    phoneNumberId: string,
    accessToken: string,
    toPhone: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    headerText?: string,
    footerText?: string,
): Promise<MetaSendMessageResponse> {
    const client = metaClient(accessToken)
    const recipientPhone = toPhone.replace(/\+/g, "").trim()
    const payload: Record<string, unknown> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientPhone,
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: bodyText },
            action: {
                buttons: buttons.slice(0, 3).map((btn) => ({
                    type: "reply",
                    reply: {
                        id: btn.id.slice(0, 256),
                        title: btn.title.slice(0, 20),
                    },
                })),
            },
        },
    }

    if (headerText) {
        (payload.interactive as Record<string, unknown>).header = {
            type: "text",
            text: headerText.slice(0, 60),
        }
    }
    if (footerText) {
        (payload.interactive as Record<string, unknown>).footer = {
            text: footerText.slice(0, 60),
        }
    }

    const { data } = await client.post<MetaSendMessageResponse>(
        `/${phoneNumberId}/messages`,
        payload,
    )
    return data
}

// ─── Send interactive list message ──────────────────────────────────────────

export async function sendWhatsAppInteractiveList(
    phoneNumberId: string,
    accessToken: string,
    toPhone: string,
    bodyText: string,
    buttonLabel: string,
    sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>,
    headerText?: string,
    footerText?: string,
): Promise<MetaSendMessageResponse> {
    const client = metaClient(accessToken)
    const recipientPhone = toPhone.replace(/\+/g, "").trim()
    const payload: Record<string, unknown> = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientPhone,
        type: "interactive",
        interactive: {
            type: "list",
            body: { text: bodyText },
            action: {
                button: buttonLabel.slice(0, 20),
                sections: sections.map((sec) => ({
                    title: sec.title.slice(0, 24),
                    rows: sec.rows.slice(0, 10).map((r) => ({
                        id: r.id.slice(0, 200),
                        title: r.title.slice(0, 24),
                        description: r.description ? r.description.slice(0, 72) : undefined,
                    })),
                })),
            },
        },
    }

    if (headerText) {
        (payload.interactive as Record<string, unknown>).header = {
            type: "text",
            text: headerText.slice(0, 60),
        }
    }
    if (footerText) {
        (payload.interactive as Record<string, unknown>).footer = {
            text: footerText.slice(0, 60),
        }
    }

    const { data } = await client.post<MetaSendMessageResponse>(
        `/${phoneNumberId}/messages`,
        payload,
    )
    return data
}

// ─── Describe a Meta API error cleanly ───────────────────────────────────────

export function describeMetaError(error: unknown): string {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data
        if (typeof data === "object" && data !== null) {
            const errObj = (data as Record<string, unknown>).error
            if (typeof errObj === "object" && errObj !== null) {
                const e = errObj as Record<string, unknown>
                return `Meta API error ${e.code ?? ""}: ${e.message ?? JSON.stringify(e)}`
            }
        }
        return error.message
    }
    return error instanceof Error ? error.message : "Unknown Meta API error"
}
