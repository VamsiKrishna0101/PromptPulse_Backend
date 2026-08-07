import { getVoiceConfig } from "./voice_config"
import type { TranscriptTurn, VoiceOutcomeIntent } from "./voice_types"

export interface BrainResponse {
    replyText: string
    intent: VoiceOutcomeIntent
    summary: string
    isUrgent: boolean
}

/**
 * Executes a conversational turn with Groq LPU (Primary) or Gemini Flash (Fallback)
 */
export async function executeVoiceBrainTurn(params: {
    systemPrompt: string
    patientName: string
    doctorName?: string
    slot?: string
    transcript: TranscriptTurn[]
    latestPatientUtterance: string
    emergencyKeywords?: string[]
}): Promise<BrainResponse> {
    const config = getVoiceConfig()
    const { systemPrompt, patientName, doctorName, slot, transcript, latestPatientUtterance, emergencyKeywords } = params

    // Check emergency triggers immediately
    const lowerUtterance = latestPatientUtterance.toLowerCase()
    const triggers = emergencyKeywords || ["chest pain", "severe pain", "fever", "emergency", "bleeding"]
    const hasEmergency = triggers.some((keyword) => lowerUtterance.includes(keyword.toLowerCase()))

    if (hasEmergency) {
        return {
            replyText: `Mee emergency situation gurinchi nenu ventane maa Duty Doctor ki live transfer chestunnanu. Please line lo undandi.`,
            intent: "URGENT_EMERGENCY_ESCALATION",
            summary: `Patient reported emergency symptom: "${latestPatientUtterance}". Escalated immediately to hospital casualty/emergency desk.`,
            isUrgent: true,
        }
    }

    // Try Groq first (blazing fast LPU)
    if (config.groqApiKey) {
        try {
            const result = await callGroqLpu(config.groqApiKey, systemPrompt, transcript, latestPatientUtterance)
            return result
        } catch (groqErr) {
            console.warn("[voice_ai_brain] Groq call failed, falling back to Gemini:", groqErr)
        }
    }

    // Fallback to Gemini if Groq is unavailable
    if (config.geminiApiKey) {
        try {
            const result = await callGeminiFlash(config.geminiApiKey, systemPrompt, transcript, latestPatientUtterance)
            return result
        } catch (geminiErr) {
            console.warn("[voice_ai_brain] Gemini call failed, using high-fidelity local logic:", geminiErr)
        }
    }

    // Smart Deterministic Dialogue Logic (Zero Latency / Sandbox Mode)
    return simulateNaturalTeluguTurn(patientName, doctorName || "Doctor", slot || "Tomorrow 10:30 AM", latestPatientUtterance)
}

/**
 * Groq LPU Ultra-Fast LLM Call
 */
async function callGroqLpu(
    apiKey: string,
    systemPrompt: string,
    history: TranscriptTurn[],
    userText: string
): Promise<BrainResponse> {
    const messages = [
        {
            role: "system",
            content: `${systemPrompt}\n\nIMPORTANT: Respond in JSON with format: {"reply": "...", "intent": "CONFIRMED|RESCHEDULED|CANCELLED|URGENT_EMERGENCY_ESCALATION|CALLBACK_REQUESTED|NOT_INTERESTED|UNKNOWN", "summary": "1 sentence recap"}`,
        },
        ...history.map((t) => ({
            role: t.sender === "ai" ? "assistant" : "user",
            content: t.text,
        })),
        { role: "user", content: userText },
    ]

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages,
            temperature: 0.3,
            max_tokens: 150,
            response_format: { type: "json_object" },
        }),
    })

    if (!res.ok) {
        throw new Error(`Groq API returned status ${res.status}: ${await res.text()}`)
    }

    const data = await res.json()
    const content = JSON.parse(data.choices?.[0]?.message?.content || "{}")

    return {
        replyText: content.reply || "Dhanyavadalu! Mee response record chesamu.",
        intent: (content.intent as VoiceOutcomeIntent) || "CONFIRMED",
        summary: content.summary || "Conversation concluded.",
        isUrgent: content.intent === "URGENT_EMERGENCY_ESCALATION",
    }
}

/**
 * Gemini 1.5 Flash Fallback
 */
async function callGeminiFlash(
    apiKey: string,
    systemPrompt: string,
    history: TranscriptTurn[],
    userText: string
): Promise<BrainResponse> {
    const { GoogleGenAI } = await import("@google/genai")
    const ai = new GoogleGenAI({ apiKey })

    const promptText = `
${systemPrompt}

Conversation History:
${history.map((h) => `${h.sender.toUpperCase()}: ${h.text}`).join("\n")}
PATIENT: ${userText}

Respond ONLY with a JSON object:
{
  "reply": "Conversational Telugu/English voice reply (1-2 sentences)",
  "intent": "CONFIRMED" | "RESCHEDULED" | "CANCELLED" | "URGENT_EMERGENCY_ESCALATION" | "NOT_INTERESTED",
  "summary": "Brief 1-sentence note for hospital receptionist"
}
`

    const response = await ai.models.generateContent({
        model: "gemini-1.5-flash",
        contents: promptText,
        config: { responseMimeType: "application/json" },
    })

    const parsed = JSON.parse(response.text || "{}")
    return {
        replyText: parsed.reply || "Namaste! Mee details save chesamu.",
        intent: (parsed.intent as VoiceOutcomeIntent) || "CONFIRMED",
        summary: parsed.summary || "Call processed.",
        isUrgent: parsed.intent === "URGENT_EMERGENCY_ESCALATION",
    }
}

/**
 * Deterministic Natural Telugu Dialogue Simulator (when testing offline/sandbox)
 */
function simulateNaturalTeluguTurn(
    patientName: string,
    doctorName: string,
    slot: string,
    utterance: string
): BrainResponse {
    const text = utterance.toLowerCase()

    if (text.includes("yes") || text.includes("vastanu") || text.includes("coming") || text.includes("sure") || text.includes("ha") || text.includes("ok")) {
        return {
            replyText: `Chala santoshangaa undi ${patientName} garu! Mee appointment ${slot} ki confirm chesamu. Dayachesi 15 minutes mundhu vachi doctor gari previous prescriptions teesukuni randi.`,
            intent: "CONFIRMED",
            summary: `Patient confirmed arrival for ${slot} with ${doctorName}.`,
            isUrgent: false,
        }
    }

    if (text.includes("no") || text.includes("kudaradhu") || text.includes("busy") || text.includes("reschedule") || text.includes("repu") || text.includes("later") || text.includes("change")) {
        return {
            replyText: `Sare ${patientName} garu, mee convenience mukhyam. Mee appointment ni Friday 11:30 AM ki reschedule cheyyala?`,
            intent: "RESCHEDULED",
            summary: `Patient requested rescheduling due to conflict. Proposed Friday morning slot.`,
            isUrgent: false,
        }
    }

    if (text.includes("cancel") || text.includes("vaddu") || text.includes("don't want") || text.includes("not coming")) {
        return {
            replyText: `Sare ${patientName} garu, mee appointment cancel chesamu. Future lo eppudaina consultation kavalante maaku call cheyyandi. Thank you!`,
            intent: "CANCELLED",
            summary: `Patient cancelled appointment. OPD slot released for walk-in patients.`,
            isUrgent: false,
        }
    }

    // Default polite acknowledgement
    return {
        replyText: `Dhanyavadalu ${patientName} garu! City Care Hospital reception desk mee request ni update chesindi. Have a healthy day!`,
        intent: "CONFIRMED",
        summary: `Call completed with patient. Slot confirmed.`,
        isUrgent: false,
    }
}
