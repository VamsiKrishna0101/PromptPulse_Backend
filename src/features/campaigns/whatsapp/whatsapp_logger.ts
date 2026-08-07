type WhatsAppLogLevel = "info" | "warn" | "error"

interface WhatsAppLogContext {
    accountId?: string
    phoneNumberId?: string
    direction?: "inbound" | "outbound"
    messageType?: string
    recipient?: string
    messageId?: string
    status?: string
    errorCode?: string
    durationMs?: number
    [key: string]: unknown
}

function safeContext(context: WhatsAppLogContext): WhatsAppLogContext {
    const copy = { ...context }
    if (copy.recipient) copy.recipient = `${String(copy.recipient).slice(0, 3)}***${String(copy.recipient).slice(-3)}`
    return copy
}

export function logWhatsAppEvent(level: WhatsAppLogLevel, event: string, context: WhatsAppLogContext = {}) {
    const record = {
        service: "whatsapp",
        event,
        timestamp: new Date().toISOString(),
        ...safeContext(context),
    }
    const line = JSON.stringify(record)
    if (level === "error") console.error(line)
    else if (level === "warn") console.warn(line)
    else console.info(line)
}
