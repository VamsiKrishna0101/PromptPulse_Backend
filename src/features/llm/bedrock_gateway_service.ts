import axios from "axios"
import type { AxiosError } from "axios"
import https from "https"

type ChatMessage = {
    role: "system" | "user"
    content: string
}

type ChatCompletionResponse = {
    choices?: {
        message?: {
            content?: string
        }
    }[]
}

const DEFAULT_BASE_URL = "https://bedrock-mantle.us-east-1.api.aws/v1"
const DEFAULT_MODEL = "mistral.ministral-3-3b-instruct"

export function hasBedrockGateway() {
    return Boolean(getBedrockGatewayApiKey())
}

export async function generateWithBedrockGateway(
    systemPrompt: string,
    userPrompt: string,
    options?: {
        temperature?: number
        maxTokens?: number
        responseFormat?: "json_object"
        model?: string
    }
) {
    const apiKey = getBedrockGatewayApiKey()
    if (!apiKey) {
        throw new Error(
            "Bedrock gateway credential is missing. Configure "
            + "AWS_BEARER_TOKEN_BEDROCK, AWS_BEDROCK_GATEWAY_API_KEY, "
            + "AWS_BEDROCK_API_KEY, or BEDROCK_API_KEY."
        )
    }

    const baseUrl = process.env.AWS_BEDROCK_OPENAI_BASE_URL ?? DEFAULT_BASE_URL
    const model = options?.model ?? process.env.AWS_BEDROCK_LLM_MODEL ?? DEFAULT_MODEL
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`
    const attempts = Number(process.env.LLM_RETRY_ATTEMPTS ?? 3)
    const baseDelay = Number(process.env.LLM_RETRY_BASE_DELAY_MS ?? 1500)
    let lastError: unknown

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const payload: Record<string, unknown> = {
                model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ] satisfies ChatMessage[],
                temperature: options?.temperature ?? 0.2,
                max_tokens: options?.maxTokens ?? 8192,
            }

            if (options?.responseFormat === "json_object") {
                payload.response_format = { type: "json_object" }
            }

            const response = await axios.post<ChatCompletionResponse>(
                url,
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                        "OpenAI-Project": process.env.AWS_BEDROCK_OPENAI_PROJECT ?? "default",
                    },
                    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 60000),
                    httpsAgent: shouldAllowInsecureLocalTls()
                        ? new https.Agent({ rejectUnauthorized: false })
                        : undefined,
                }
            )

            const text = response.data.choices?.[0]?.message?.content?.trim()
            if (!text) {
                throw new Error("Bedrock gateway returned an empty response.")
            }
            return text
        } catch (error) {
            lastError = normalizeBedrockError(error, url, model)
            if (attempt < attempts) {
                await new Promise(resolve => setTimeout(resolve, baseDelay * attempt))
            }
        }
    }

    throw lastError
}

function getBedrockGatewayApiKey() {
    return (
        process.env.AWS_BEARER_TOKEN_BEDROCK ||
        process.env.AWS_BEDROCK_GATEWAY_API_KEY ||
        process.env.AWS_BEDROCK_API_KEY ||
        process.env.BEDROCK_API_KEY ||
        ""
    ).trim()
}

function shouldAllowInsecureLocalTls() {
    return process.env.ALLOW_INSECURE_LOCAL_TLS === "true" || process.env.NODE_ENV !== "production"
}

function normalizeBedrockError(error: unknown, url: string, model: string) {
    if (!axios.isAxiosError(error)) return error

    const axiosError = error as AxiosError
    const responseData = axiosError.response?.data
    const body = typeof responseData === "string"
        ? responseData
        : responseData
            ? JSON.stringify(responseData)
            : ""

    return new Error(
        [
            `Bedrock gateway request failed with status ${axiosError.response?.status ?? "unknown"}.`,
            `url=${url}`,
            `model=${model}`,
            body ? `body=${body.slice(0, 500)}` : null,
        ].filter(Boolean).join(" ")
    )
}
