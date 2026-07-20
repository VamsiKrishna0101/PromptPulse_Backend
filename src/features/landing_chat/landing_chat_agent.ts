import { generateGroqJsonText } from "../llm/groq_service"
import type { LandingChatIntent, LandingChatMessageInput, LandingChatResponse } from "./landing_chat_types"
import { LANDING_CHAT_DEFAULT_SUGGESTIONS, LANDING_CHAT_PRODUCT_FACTS } from "./landing_chat_knowledge"

const VALID_INTENTS = new Set<LandingChatIntent>([
    "pricing",
    "trial",
    "engines",
    "setup",
    "credits",
    "agencies",
    "demo",
    "support",
    "general",
])

const CTA_BY_INTENT: Record<LandingChatIntent, LandingChatResponse["cta"]> = {
    pricing: { label: "See pricing", href: "/pricing" },
    trial: { label: "Start trial", href: "/signup" },
    engines: { label: "Start tracking", href: "/signup" },
    setup: { label: "Create account", href: "/signup" },
    credits: { label: "View plans", href: "/pricing" },
    agencies: { label: "Book demo", href: "/book-demo" },
    demo: { label: "Book demo", href: "/book-demo" },
    support: { label: "Book demo", href: "/book-demo" },
    general: { label: "Start free", href: "/signup" },
}

function buildSystemPrompt() {
    return `
You are the PromptPulse landing page assistant.
Answer prospective customers clearly and briefly using only the product facts below.

Return only valid JSON with this shape:
{
  "intent": "pricing|trial|engines|setup|credits|agencies|demo|support|general",
  "answer": "1-3 short paragraphs, no markdown tables",
  "suggestions": ["short follow-up", "short follow-up", "short follow-up"],
  "cta": {"label": "short label", "href": "/internal-path"}
}

Rules:
- Be helpful, specific, and honest.
- Use internal hrefs only: /signup, /pricing, /book-demo, /login.
- Keep URLs and route paths out of the answer text; put navigation only in the cta object.
- For contact/team/support questions, intent must be "support" and the answer must mention leaving a message in chat or booking a demo.
- Do not claim a phone number or direct email exists.
- Do not answer agency questions unless the user asks about agencies, clients, teams, seats, or multiple brands.
- If unsure, answer with what PromptPulse does and invite the visitor to leave a message.

Product facts:
${LANDING_CHAT_PRODUCT_FACTS}
`.trim()
}

function buildUserPrompt(input: LandingChatMessageInput) {
    return JSON.stringify({
        message: input.message,
        page_path: input.page_path ?? "/",
    })
}

function stripJsonFence(value: string) {
    return value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()
}

function cleanSuggestions(value: unknown) {
    if (!Array.isArray(value)) return LANDING_CHAT_DEFAULT_SUGGESTIONS.slice(0, 3)
    const suggestions = value
        .filter((item): item is string => typeof item === "string")
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 3)
    return suggestions.length ? suggestions : LANDING_CHAT_DEFAULT_SUGGESTIONS.slice(0, 3)
}

function cleanCta(intent: LandingChatIntent, value: unknown) {
    if (!value || typeof value !== "object") return CTA_BY_INTENT[intent]

    const candidate = value as { label?: unknown; href?: unknown }
    const label = typeof candidate.label === "string" ? candidate.label.trim().slice(0, 40) : ""
    const href = typeof candidate.href === "string" ? candidate.href.trim() : ""
    const allowedHref = ["/signup", "/pricing", "/book-demo", "/login"].includes(href)

    if (!label || !allowedHref) return CTA_BY_INTENT[intent]
    return { label, href }
}

function cleanAnswer(value: string) {
    return value
        .replace(/\[([^\]]+)\]\((?:\/signup|\/pricing|\/book-demo|\/login)\)/g, "$1")
        .replace(/\s+(?:at|here):?\s*(?:\/signup|\/pricing|\/book-demo|\/login)\b/gi, "")
        .replace(/\b(?:\/signup|\/pricing|\/book-demo|\/login)\b/g, "")
        .replace(/\s{2,}/g, " ")
        .trim()
}

function parseAgentResponse(rawText: string): LandingChatResponse {
    const parsed = JSON.parse(stripJsonFence(rawText)) as {
        answer?: unknown
        intent?: unknown
        suggestions?: unknown
        cta?: unknown
    }

    const intent: LandingChatIntent = typeof parsed.intent === "string" && VALID_INTENTS.has(parsed.intent as LandingChatIntent)
        ? parsed.intent as LandingChatIntent
        : "general"

    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : ""
    if (!answer) throw new Error("Landing chat agent returned an empty answer.")

    return {
        intent,
        answer: cleanAnswer(answer).slice(0, 1200),
        suggestions: cleanSuggestions(parsed.suggestions),
        cta: cleanCta(intent, parsed.cta),
    }
}

export async function answerLandingChatWithAgent(input: LandingChatMessageInput): Promise<LandingChatResponse | null> {
    if (process.env.LANDING_CHAT_AGENT_ENABLED === "false") return null
    if (!process.env.GROQ_API_KEY) return null

    try {
        const rawText = await generateGroqJsonText({
            systemPrompt: buildSystemPrompt(),
            userPrompt: buildUserPrompt(input),
            model: process.env.LANDING_CHAT_GROQ_MODEL ?? "llama-3.3-70b-versatile",
            temperature: 0,
            timeoutMs: 30000,
        })
        return parseAgentResponse(rawText)
    } catch (error) {
        console.warn("[landing-chat] agent failed; using fallback answer", error)
        return null
    }
}
