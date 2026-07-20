import axios from "axios"
import https from "node:https"

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"

export async function generateGroqJsonText(params: {
    systemPrompt: string
    userPrompt: string
    model?: string
    temperature?: number
    timeoutMs?: number
}): Promise<string> {
    if (!process.env.GROQ_API_KEY) {
        throw new Error("GROQ_API_KEY is missing.")
    }

    const response = await postGroqChatCompletion({
        model: params.model ?? "llama-3.3-70b-versatile",
        temperature: params.temperature ?? 0,
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: params.systemPrompt },
            { role: "user", content: params.userPrompt },
        ],
    }, params.timeoutMs ?? 30000)

    const raw = response.data?.choices?.[0]?.message?.content
    if (!raw || typeof raw !== "string") {
        throw new Error("Groq returned an empty response.")
    }

    return raw
}

async function postGroqChatCompletion(payload: Record<string, unknown>, timeoutMs: number) {
    const config = {
        headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
        },
        timeout: timeoutMs,
    }

    try {
        return await axios.post(GROQ_CHAT_COMPLETIONS_URL, payload, config)
    } catch (error) {
        if (!shouldAllowInsecureLocalTls() || !isLocalCertificateError(error)) throw error
        return axios.post(GROQ_CHAT_COMPLETIONS_URL, payload, {
            ...config,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        })
    }
}

function isLocalCertificateError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as { code?: string }).code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
}

function shouldAllowInsecureLocalTls() {
    return process.env.ALLOW_INSECURE_LOCAL_TLS === "true" || process.env.NODE_ENV !== "production"
}
