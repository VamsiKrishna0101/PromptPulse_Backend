import crypto from "node:crypto"
import prisma from "../../lib/prisma"
import type { LandingChatIntent, LandingChatMessageInput, LandingChatResponse, LandingLeadInput } from "./landing_chat_types"
import { answerLandingChatWithAgent } from "./landing_chat_agent"
import { LANDING_CHAT_DEFAULT_SUGGESTIONS } from "./landing_chat_knowledge"

function normalize(value: string) {
    return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function classifyIntent(message: string): LandingChatIntent {
    const text = normalize(message)

    if (/\b(contact|support|help|human|person|email|message|reach|talk to (?:the )?team|promptpulse team|team contact)\b/.test(text)) return "support"
    if (/\b(price|pricing|cost|plan|plans|tiers|starter|growth|pro|monthly|annual|yearly|available)\b/.test(text)) return "pricing"
    if (/\b(trial|free|credit card|card required|14 day|fourteen)\b/.test(text)) return "trial"
    if (/\b(chatgpt|gemini|perplexity|copilot|google ai|ai mode|ai overview|engine|model)\b/.test(text)) return "engines"
    if (/\b(setup|onboard|website|brand|prompt|start|install|how long)\b/.test(text)) return "setup"
    if (/\b(credit|credits|report|pdf|csv|export|invoice)\b/.test(text)) return "credits"
    if (/\b(agency|client|multi.?client|seat|team|white label)\b/.test(text)) return "agencies"
    if (/\b(demo|call|meeting|book|zoom|talk|sales)\b/.test(text)) return "demo"

    return "general"
}

function answerForIntent(intent: LandingChatIntent): LandingChatResponse {
    if (intent === "pricing") {
        return {
            intent,
            answer: "PromptPulse has Starter at ₹2,499/mo with 2,250 credits, Growth at ₹4,999/mo with 4,500 included + 500 bonus credits, and Pro at ₹9,999/mo with 11,250 included + 1,750 bonus credits. Every paid plan includes the complete PromptPulse feature set; plans differ only by capacity.",
            suggestions: ["What is included in Growth?", "How do credits work?", "Can agencies use a shared wallet?"],
            cta: { label: "See pricing", href: "/pricing" },
        }
    }

    if (intent === "trial") {
        return {
            intent,
            answer: "The trial is 7 days and does not require a credit card. It includes 105 credits, up to 5 prompts across 3 engines, 2 AI reports, and limited Sara access so you can see the product value before paying.",
            suggestions: ["What happens after trial?", "Can I book a demo?", "Which plan fits my team?"],
            cta: { label: "Start trial", href: "/signup" },
        }
    }

    if (intent === "engines") {
        return {
            intent,
            answer: "PromptPulse tracks AI visibility across ChatGPT, Gemini, Perplexity, Google AI Mode, and Copilot. Every paid plan can use all five engines; the free trial starts with three engines so you can evaluate the workflow before paying.",
            suggestions: ["How often do runs refresh?", "Do you track sources?", "Can I choose country targeting?"],
            cta: { label: "Start tracking", href: "/signup" },
        }
    }

    if (intent === "setup") {
        return {
            intent,
            answer: "Setup is simple: add your brand, choose your primary market, review suggested prompts, add competitors, and launch your first visibility run. You can also bulk upload your own prompts during onboarding.",
            suggestions: ["Can I upload prompts?", "How many competitors can I track?", "What data do I need?"],
            cta: { label: "Create account", href: "/signup" },
        }
    }

    if (intent === "credits") {
        return {
            intent,
            answer: "One credit covers one successful prompt on one AI engine. AI visibility reports use 25 credits, content briefs use 15, and Reddit intelligence starts at 25. Failed provider requests and retries are not charged; agencies can top up a shared wallet from 1,000 credits.",
            suggestions: ["Do exports use credits?", "Which plan has more credits?", "Can agencies share credits?"],
            cta: { label: "View plans", href: "/pricing" },
        }
    }

    if (intent === "agencies") {
        return {
            intent,
            answer: "Yes. Agencies can use one shared PAYG wallet across client workspaces, top up from 1,000 credits, track competitors, export reports, and use AI Workspace for action plans. Pro includes 13,000 monthly credits with +1,750 bonus credits; larger teams can add PAYG capacity.",
            suggestions: ["How do agency credits work?", "Which engines are in Pro?", "Can I book an agency demo?"],
            cta: { label: "Book a demo", href: "/book-demo" },
        }
    }

    if (intent === "demo") {
        return {
            intent,
            answer: "You can book a demo from the demo page. Pick your country and a time that maps cleanly to 7 AM-11 PM IST, and we will follow up with the meeting link.",
            suggestions: ["What will the demo cover?", "Can I ask pricing questions?", "Start free instead"],
            cta: { label: "Book demo", href: "/book-demo" },
        }
    }

    if (intent === "support") {
        return {
            intent,
            answer: "You can contact the PromptPulse team by leaving a message here with your email, or by booking a demo if you want to talk through fit, pricing, or setup live. Existing users can also use the in-app Help Agent after login for account-aware support.",
            suggestions: ["Leave a message", "Book a demo", "I am an existing user"],
            cta: { label: "Book demo", href: "/book-demo" },
        }
    }

    return {
        intent,
        answer: "PromptPulse helps brands understand how they appear in AI search answers, which competitors win recommendations, which sources influence results, and what actions to take next. Ask about pricing, setup, AI engines, reports, credits, or agencies.",
        suggestions: LANDING_CHAT_DEFAULT_SUGGESTIONS,
        cta: { label: "Start free", href: "/signup" },
    }
}

export async function answerLandingChat(input: LandingChatMessageInput): Promise<LandingChatResponse> {
    const message = input.message.trim()
    if (message.length < 2) {
        return {
            intent: "general",
            answer: "Ask me anything about PromptPulse pricing, setup, AI engines, reports, credits, or demos.",
            suggestions: LANDING_CHAT_DEFAULT_SUGGESTIONS,
        }
    }

    const agentAnswer = await answerLandingChatWithAgent(input)
    if (agentAnswer) return agentAnswer

    return answerForIntent(classifyIntent(message))
}

export async function createLandingLead(input: LandingLeadInput, meta: { ip?: string; user_agent?: string }) {
    const message = input.message.trim()
    if (!message) throw new Error("MESSAGE_REQUIRED")

    const email = input.email?.trim().toLowerCase() || null
    const topic = classifyIntent(message)
    const ipHash = meta.ip
        ? crypto.createHash("sha256").update(meta.ip).digest("hex")
        : null

    return prisma.publicChatLead.create({
        data: {
            message,
            email,
            name: input.name?.trim() || null,
            company: input.company?.trim() || null,
            page_path: input.page_path?.slice(0, 240) || null,
            topic,
            user_agent: meta.user_agent?.slice(0, 500) || null,
            ip_hash: ipHash,
        },
        select: {
            id: true,
            created_at: true,
        },
    })
}
