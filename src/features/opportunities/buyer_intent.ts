export type BuyerIntentStage = "DISCOVERY" | "CONSIDERATION" | "DECISION" | "REPUTATION"
export type BuyerIntentValue = "HIGH" | "MEDIUM" | "LOW"

export type BuyerIntent = {
    key: string
    label: string
    stage: BuyerIntentStage
    value: BuyerIntentValue
    reason: string
}

type IntentRule = {
    key: string
    label: string
    stage: BuyerIntentStage
    value: BuyerIntentValue
    pattern: RegExp
    reason: string
}

const RULES: IntentRule[] = [
    {
        key: "urgent_local",
        label: "Urgent local decision",
        stage: "DECISION",
        value: "HIGH",
        pattern: /\b(emergency|urgent|today|tonight|open now|near me)\b/i,
        reason: "The buyer is looking for an immediate local provider.",
    },
    {
        key: "comparison",
        label: "Brand comparison",
        stage: "DECISION",
        value: "HIGH",
        pattern: /\b(compare|comparison|versus|\bvs\b|better than|alternative|alternatives)\b/i,
        reason: "The buyer is actively choosing between providers.",
    },
    {
        key: "price",
        label: "Price and value",
        stage: "DECISION",
        value: "HIGH",
        pattern: /\b(price|pricing|cost|affordable|budget|insurance|cashless|quote)\b/i,
        reason: "The buyer is evaluating affordability and purchase conditions.",
    },
    {
        key: "recommendation",
        label: "Best-provider recommendation",
        stage: "CONSIDERATION",
        value: "HIGH",
        pattern: /\b(best|top|recommend|recommended|which .* should|which .* choose)\b/i,
        reason: "The buyer wants an AI-generated shortlist or recommendation.",
    },
    {
        key: "trust",
        label: "Trust and reputation",
        stage: "REPUTATION",
        value: "MEDIUM",
        pattern: /\b(review|reviews|trusted|reliable|experienced|safe|good|reputation)\b/i,
        reason: "The buyer is validating trust, proof, and reputation.",
    },
    {
        key: "service",
        label: "Service discovery",
        stage: "CONSIDERATION",
        value: "MEDIUM",
        pattern: /\b(service|treatment|solution|provider|company|hospital|clinic|software|agency)\b/i,
        reason: "The buyer is researching providers for a defined need.",
    },
]

export function classifyBuyerIntent(promptText: string, promptType?: string | null): BuyerIntent {
    const haystack = `${promptText} ${promptType ?? ""}`
    const matched = RULES.find(rule => rule.pattern.test(haystack))
    if (matched) {
        return {
            key: matched.key,
            label: matched.label,
            stage: matched.stage,
            value: matched.value,
            reason: matched.reason,
        }
    }

    return {
        key: "informational",
        label: "Category discovery",
        stage: "DISCOVERY",
        value: "LOW",
        reason: "The buyer is learning about the category before forming a shortlist.",
    }
}

