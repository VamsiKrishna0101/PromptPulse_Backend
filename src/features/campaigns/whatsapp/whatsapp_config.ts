const DEFAULT_META_GRAPH_API_VERSION = "v21.0"

export function getMetaGraphApiVersion(): string {
    const configured = process.env.META_GRAPH_API_VERSION?.trim()
    return configured || DEFAULT_META_GRAPH_API_VERSION
}

export function getMetaGraphApiBase(): string {
    return `https://graph.facebook.com/${getMetaGraphApiVersion()}`
}

export function getWhatsAppWebhookUrl(): string | null {
    const value = process.env.WHATSAPP_WEBHOOK_PUBLIC_URL?.trim()
    return value || null
}

export function getWebhookHealth(): { configured: boolean; url: string | null; reason?: string } {
    const url = getWhatsAppWebhookUrl()
    if (!url) {
        return { configured: false, url: null, reason: "WHATSAPP_WEBHOOK_PUBLIC_URL is not configured" }
    }

    try {
        const parsed = new URL(url)
        if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
            return { configured: false, url, reason: "Production webhook URL must use HTTPS" }
        }
        return { configured: true, url }
    } catch {
        return { configured: false, url, reason: "WHATSAPP_WEBHOOK_PUBLIC_URL is not a valid URL" }
    }
}

export function getWebhookVerifyToken(): string | null {
    const value = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim()
    return value || null
}

export function getConfiguredWhatsAppTestAccount() {
    const values = {
        wabaId: process.env.WHATSAPP_TEST_WABA_ID?.trim(),
        phoneNumberId: process.env.WHATSAPP_TEST_PHONE_NUMBER_ID?.trim(),
        displayPhone: process.env.WHATSAPP_TEST_DISPLAY_PHONE?.trim(),
        displayName: process.env.WHATSAPP_TEST_DISPLAY_NAME?.trim() || "Meta Test WhatsApp",
        accessToken: process.env.WHATSAPP_TEST_ACCESS_TOKEN?.trim(),
    }
    return Object.values(values).every(Boolean) ? values as Required<typeof values> : null
}
