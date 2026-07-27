import prisma from "../../lib/prisma"
import type { OpportunityItem } from "./opportunity_types"

function actionCategory(item: OpportunityItem) {
    if (item.type === "SOURCE_GAP") return "SOURCE"
    if (item.content_gap.action === "CREATE" || item.content_gap.action === "REFRESH") return "CONTENT"
    if (item.type === "SENTIMENT_GAP") return "COMPETITOR"
    return "CONTENT"
}

function effortScore(effort: OpportunityItem["effort"]) {
    if (effort === "LOW") return 25
    if (effort === "MEDIUM") return 55
    return 85
}

function confidenceScore(confidence: OpportunityItem["confidence"]) {
    if (confidence === "HIGH") return 90
    if (confidence === "MEDIUM") return 70
    if (confidence === "LOW") return 45
    return 25
}

export async function createOpportunityAction(input: {
    projectId: string
    userId: string
    item: OpportunityItem
}) {
    const existing = await prisma.actionQueueItem.findFirst({
        where: {
            project_id: input.projectId,
            user_id: input.userId,
            source_type: "OPPORTUNITY",
            source_ref_id: input.item.id,
            status: { not: "DISMISSED" },
        },
    })
    if (existing) return existing

    const dueAt = new Date()
    dueAt.setDate(dueAt.getDate() + (input.item.effort === "LOW" ? 7 : input.item.effort === "MEDIUM" ? 14 : 30))

    return prisma.actionQueueItem.create({
        data: {
            project_id: input.projectId,
            user_id: input.userId,
            title: input.item.content_gap.suggested_title,
            description: input.item.content_gap.gap_reason,
            category: actionCategory(input.item),
            priority: input.item.impact,
            impact_score: input.item.impact_score,
            effort_score: effortScore(input.item.effort),
            confidence_score: confidenceScore(input.item.confidence),
            recommended_action: input.item.next_step,
            success_metric: input.item.verification.success_metric,
            source_type: "OPPORTUNITY",
            source_ref_id: input.item.id,
            due_at: dueAt,
            evidence: {
                prompt_id: input.item.prompt_id,
                prompt_text: input.item.prompt_text,
                buyer_intent: input.item.buyer_intent,
                brand_outcome: input.item.brand_outcome,
                competitor_outcome: input.item.competitor_outcome,
                competitor_name: input.item.competitor_name,
                target_page: input.item.target_page,
                supporting_urls: input.item.supporting_urls,
                source_domains: input.item.top_sources.map(source => source.domain),
                baseline: input.item.verification.baseline,
                verification_after_days: input.item.verification.recheck_after_days,
            },
        },
    })
}

