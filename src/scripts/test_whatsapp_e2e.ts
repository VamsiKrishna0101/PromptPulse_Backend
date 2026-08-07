import "dotenv/config"
import { sendWhatsAppTextMessage } from "../features/campaigns/whatsapp/whatsapp_meta_api"

const phoneNumberId = process.env.WHATSAPP_E2E_PHONE_NUMBER_ID?.trim()
const accessToken = process.env.WHATSAPP_E2E_ACCESS_TOKEN?.trim()
const recipientPhone = process.env.WHATSAPP_E2E_RECIPIENT_PHONE?.trim()

if (!phoneNumberId || !accessToken || !recipientPhone) {
    throw new Error("Set WHATSAPP_E2E_PHONE_NUMBER_ID, WHATSAPP_E2E_ACCESS_TOKEN, and WHATSAPP_E2E_RECIPIENT_PHONE before running this test")
}

const result = await sendWhatsAppTextMessage(
    phoneNumberId,
    accessToken,
    recipientPhone,
    "PromptPulse WhatsApp end-to-end test. Reply with OK when received.",
)

console.info(JSON.stringify({ ok: true, messageId: result.messages?.[0]?.id ?? null }))
