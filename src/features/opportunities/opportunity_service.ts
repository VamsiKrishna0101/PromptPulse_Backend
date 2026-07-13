import prisma from "../../lib/prisma"
import { buildChatWhere, type DashboardFilters } from "../dashboard/dashboard_service"
import type { ContentGapPlan, OpportunityEffort, OpportunityImpact, OpportunityItem, OpportunitySource, OpportunityType, OpportunitiesResponse } from "./opportunity_types"

type ChatWithEvidence = Awaited<ReturnType<typeof loadOpportunityChats>>[number]

function cleanText(value: string, max = 260) {
    return value.replace(/\s+/g, " ").trim().slice(0, max)
}

function rounded(value: number) {
    return Number(value.toFixed(1))
}

function avg(values: number[]) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function impactLabel(score: number): OpportunityImpact {
    if (score >= 72) return "HIGH"
    if (score >= 42) return "MEDIUM"
    return "LOW"
}

function effortFor(type: OpportunityType, sourceCount: number): OpportunityEffort {
    if (type === "MISSING") return "LOW"
    if (type === "SOURCE_GAP" && sourceCount > 2) return "HIGH"
    if (type === "OUTRANKED") return "MEDIUM"
    return "LOW"
}

function opportunityTitle(type: OpportunityType, competitor: string) {
    if (type === "MISSING") return `${competitor} appears where you are missing`
    if (type === "OUTRANKED") return `${competitor} is ranking ahead`
    if (type === "SOURCE_GAP") return `Source gap behind ${competitor}`
    return `${competitor} has stronger sentiment`
}

function inferContentType(promptText: string, type: OpportunityType) {
    const text = promptText.toLowerCase()

    if (text.includes("alternative") || text.includes("alternatives")) return "Alternatives page"
    if (text.includes("compare") || text.includes(" vs ") || text.includes("versus")) return "Comparison page"
    if (text.includes("best") || text.includes("top")) return "Best tools / category list"
    if (text.includes("pricing") || text.includes("cost")) return "Pricing and value page"
    if (text.includes("how") || text.includes("what") || text.includes("why")) return "Educational answer page"
    if (type === "SOURCE_GAP") return "Source-backed category page"
    return "Category landing page"
}

function suggestedTitle(promptText: string, brandName: string, type: OpportunityType) {
    const cleaned = cleanText(promptText, 90).replace(/[?.!]+$/, "")
    const contentType = inferContentType(promptText, type)

    if (contentType === "Alternatives page") return `${brandName} alternatives for ${cleaned.toLowerCase()}`
    if (contentType === "Comparison page") return `${brandName} vs competitors: ${cleaned}`
    if (contentType === "Best tools / category list") return `${cleaned}: where ${brandName} fits`
    if (contentType === "Pricing and value page") return `${brandName} pricing and value for ${cleaned.toLowerCase()}`
    return `${cleaned}: a practical guide from ${brandName}`
}

function contentAction(type: OpportunityType): ContentGapPlan["action"] {
    if (type === "MISSING") return "CREATE"
    if (type === "SOURCE_GAP") return "REFRESH"
    return "OPTIMIZE"
}

function missingAngles(input: {
    type: OpportunityType
    competitorName: string
    sources: OpportunitySource[]
}) {
    const sourceDomains = input.sources.slice(0, 2).map(source => source.domain)
    const angles = new Set<string>()

    if (input.type === "MISSING") {
        angles.add("Direct answer to the prompt intent")
        angles.add(`Why buyers compare you with ${input.competitorName}`)
    }
    if (input.type === "OUTRANKED") {
        angles.add("Clearer comparison proof")
        angles.add("Stronger use-case positioning")
    }
    if (input.type === "SOURCE_GAP") {
        angles.add("Third-party source and citation coverage")
        if (sourceDomains.length) angles.add(`Evidence from ${sourceDomains.join(" and ")}`)
    }
    if (input.type === "SENTIMENT_GAP") {
        angles.add("Trust proof, reviews, outcomes, and customer evidence")
    }

    angles.add("Short FAQ answers for AI snippets")
    return Array.from(angles).slice(0, 4)
}

function optimizationFocus(type: OpportunityType) {
    if (type === "MISSING") {
        return ["Create one focused page", "Add FAQs", "Mention category and use cases"]
    }
    if (type === "OUTRANKED") {
        return ["Improve comparison copy", "Add proof points", "Clarify differentiation"]
    }
    if (type === "SOURCE_GAP") {
        return ["Add credible citations", "Reference source domains", "Improve external proof"]
    }
    return ["Improve tone", "Add customer evidence", "Reduce vague claims"]
}

function buildContentGapPlan(input: {
    type: OpportunityType
    promptText: string
    brandName: string
    competitorName: string
    ownVisibility: number
    competitorVisibility: number
    sources: OpportunitySource[]
    impactScore: number
}): ContentGapPlan {
    const action = contentAction(input.type)
    const contentType = inferContentType(input.promptText, input.type)
    const sourceLabel = input.sources.length ? ` Sources like ${input.sources.slice(0, 2).map(source => source.domain).join(" and ")} are reinforcing competitor answers.` : ""

    return {
        gap_reason: input.type === "MISSING"
            ? `${input.competitorName} appears for this intent while ${input.brandName} is missing or weak.`
            : `${input.competitorName} has stronger AI-answer evidence for this intent.${sourceLabel}`,
        recommended_content_type: contentType,
        suggested_title: suggestedTitle(input.promptText, input.brandName, input.type),
        action,
        priority_reason: `Impact score ${input.impactScore}; competitor visibility ${rounded(input.competitorVisibility)}% vs your ${rounded(input.ownVisibility)}%.`,
        missing_angles: missingAngles({ type: input.type, competitorName: input.competitorName, sources: input.sources }),
        optimization_focus: optimizationFocus(input.type),
    }
}

function opportunityDescription(input: {
    type: OpportunityType
    competitorName: string
    ownVisibility: number
    competitorVisibility: number
    ownPosition: number | null
    competitorPosition: number | null
    ownSentiment: number | null
    competitorSentiment: number | null
}) {
    const competitorVisibility = rounded(input.competitorVisibility)
    const ownVisibility = rounded(input.ownVisibility)

    if (input.type === "OUTRANKED" && input.ownPosition && input.competitorPosition) {
        return `${input.competitorName} ranks at #${rounded(input.competitorPosition)} while your brand ranks at #${rounded(input.ownPosition)} for this prompt.`
    }

    if (input.type === "SENTIMENT_GAP" && input.ownSentiment && input.competitorSentiment) {
        return `${input.competitorName} has ${rounded(input.competitorSentiment)} sentiment versus your ${rounded(input.ownSentiment)} for matching answers.`
    }

    if (input.type === "SOURCE_GAP") {
        return `${input.competitorName} is reinforced by stronger source evidence across ${competitorVisibility}% of matching answers.`
    }

    return `${input.competitorName} is visible in ${competitorVisibility}% of matching answers while your brand appears in ${ownVisibility}%.`
}

function nextStep(type: OpportunityType, competitor: string, sources: OpportunitySource[]) {
    if (type === "SOURCE_GAP" && sources.length) {
        return `Prioritize ${sources.slice(0, 2).map(source => source.domain).join(" and ")} with comparison, category, or editorial proof for this prompt.`
    }
    if (type === "MISSING") {
        return `Create or refresh a page that directly answers this prompt, then make sure ${competitor} comparison language is covered honestly.`
    }
    if (type === "OUTRANKED") {
        return `Strengthen the prompt intent with clearer positioning, proof points, and comparison copy against ${competitor}.`
    }
    return `Improve trust signals and messaging around this prompt so AI answers describe your brand more favorably.`
}

async function loadOpportunityChats(project_id: string, filters: DashboardFilters) {
    return prisma.chat.findMany({
        where: buildChatWhere(project_id, filters),
        include: {
            prompt: {
                select: {
                    id: true,
                    text: true,
                    topic: true,
                }
            },
            brand_mentions: {
                select: {
                    brand_name: true,
                    position: true,
                    sentiment_score: true,
                }
            },
            sources: {
                select: {
                    domain: true,
                    title: true,
                    source_type: true,
                    is_cited: true,
                }
            }
        },
        orderBy: { created_at: "desc" },
    })
}

function sourceEvidence(chats: ChatWithEvidence[], competitorName: string): OpportunitySource[] {
    const domainMap = new Map<string, OpportunitySource>()

    for (const chat of chats) {
        const competitorWasMentioned = chat.brand_mentions.some(mention => mention.brand_name.toLowerCase() === competitorName.toLowerCase())
        if (!competitorWasMentioned) continue

        const uniqueDomains = new Set<string>()
        for (const source of chat.sources) {
            if (!source.domain || uniqueDomains.has(source.domain)) continue
            uniqueDomains.add(source.domain)
            const existing = domainMap.get(source.domain)
            domainMap.set(source.domain, {
                domain: source.domain,
                title: existing?.title ?? source.title ?? null,
                source_type: existing?.source_type ?? source.source_type ?? null,
                mentions: (existing?.mentions ?? 0) + 1,
            })
        }
    }

    return Array.from(domainMap.values())
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, 4)
}

function buildOpportunity(input: {
    type: OpportunityType
    promptChats: ChatWithEvidence[]
    prompt: ChatWithEvidence["prompt"]
    brandName: string
    competitorName: string
    ownVisibility: number
    competitorVisibility: number
    ownPosition: number | null
    competitorPosition: number | null
    ownSentiment: number | null
    competitorSentiment: number | null
    totalChats: number
}): OpportunityItem {
    const sources = sourceEvidence(input.promptChats, input.competitorName)
    const visibilityGap = Math.max(0, input.competitorVisibility - input.ownVisibility)
    const rankGap = input.ownPosition && input.competitorPosition ? Math.max(0, input.ownPosition - input.competitorPosition) * 8 : 0
    const sentimentGap = input.ownSentiment && input.competitorSentiment ? Math.max(0, input.competitorSentiment - input.ownSentiment) * 0.4 : 0
    const evidenceBoost = Math.min(16, input.totalChats * 3)
    const impactScore = Math.min(100, Math.round(visibilityGap * 1.15 + rankGap + sentimentGap + evidenceBoost + sources.length * 3))
    const effort = effortFor(input.type, sources.length)
    const sample = input.promptChats.find(chat =>
        chat.brand_mentions.some(mention => mention.brand_name.toLowerCase() === input.competitorName.toLowerCase())
    )?.raw_response

    return {
        id: `${input.prompt.id}-${input.competitorName}-${input.type}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        type: input.type,
        title: opportunityTitle(input.type, input.competitorName),
        description: opportunityDescription(input),
        prompt_id: input.prompt.id,
        prompt_text: input.prompt.text,
        topic: input.prompt.topic,
        competitor_name: input.competitorName,
        own_visibility: rounded(input.ownVisibility),
        competitor_visibility: rounded(input.competitorVisibility),
        own_position: input.ownPosition ? rounded(input.ownPosition) : null,
        competitor_position: input.competitorPosition ? rounded(input.competitorPosition) : null,
        own_sentiment: input.ownSentiment ? rounded(input.ownSentiment) : null,
        competitor_sentiment: input.competitorSentiment ? rounded(input.competitorSentiment) : null,
        impact_score: impactScore,
        impact: impactLabel(impactScore),
        effort,
        evidence_count: input.totalChats,
        top_sources: sources,
        content_gap: buildContentGapPlan({
            type: input.type,
            promptText: input.prompt.text,
            brandName: input.brandName,
            competitorName: input.competitorName,
            ownVisibility: input.ownVisibility,
            competitorVisibility: input.competitorVisibility,
            sources,
            impactScore,
        }),
        next_step: nextStep(input.type, input.competitorName, sources),
        sample_response: sample ? cleanText(sample, 320) : null,
    }
}

export async function getOpportunities(project_id: string, filters: DashboardFilters = {}): Promise<OpportunitiesResponse> {
    const [project, chats] = await Promise.all([
        prisma.project.findUniqueOrThrow({
            where: { id: project_id },
            include: { competitors: { select: { name: true } } }
        }),
        loadOpportunityChats(project_id, filters)
    ])

    if (!chats.length) {
        return {
            summary: { total: 0, high_impact: 0, quick_wins: 0, create_pages: 0, refresh_pages: 0, competitor_gaps: 0, source_gaps: 0, sentiment_gaps: 0 },
            opportunities: []
        }
    }

    const trackedCompetitors = new Set(project.competitors.map(competitor => competitor.name.toLowerCase()))
    const promptMap = new Map<string, ChatWithEvidence[]>()
    for (const chat of chats) {
        const rows = promptMap.get(chat.prompt.id) ?? []
        rows.push(chat)
        promptMap.set(chat.prompt.id, rows)
    }

    const opportunities: OpportunityItem[] = []

    for (const promptChats of promptMap.values()) {
        const total = promptChats.length
        const prompt = promptChats[0].prompt
        const ownMentionChats = promptChats.filter(chat => chat.brand_mentioned)
        const ownVisibility = (ownMentionChats.length / total) * 100
        const ownPosition = avg(ownMentionChats.map(chat => chat.brand_position).filter((value): value is number => value !== null))
        const ownSentiment = avg(ownMentionChats.map(chat => chat.sentiment_score).filter((value): value is number => value !== null))

        const competitorMap = new Map<string, { count: number; positions: number[]; sentiments: number[] }>()
        for (const chat of promptChats) {
            const seenInChat = new Set<string>()
            for (const mention of chat.brand_mentions) {
                const name = mention.brand_name.trim()
                if (!name || name.toLowerCase() === project.brand_name.toLowerCase()) continue
                if (trackedCompetitors.size && !trackedCompetitors.has(name.toLowerCase())) continue
                if (seenInChat.has(name.toLowerCase())) continue
                seenInChat.add(name.toLowerCase())

                const current = competitorMap.get(name) ?? { count: 0, positions: [], sentiments: [] }
                current.count += 1
                if (mention.position !== null) current.positions.push(mention.position)
                if (mention.sentiment_score !== null) current.sentiments.push(mention.sentiment_score)
                competitorMap.set(name, current)
            }
        }

        for (const [competitorName, competitor] of competitorMap.entries()) {
            const competitorVisibility = (competitor.count / total) * 100
            const competitorPosition = avg(competitor.positions)
            const competitorSentiment = avg(competitor.sentiments)
            const sourceCount = sourceEvidence(promptChats, competitorName).length
            const visibilityGap = competitorVisibility - ownVisibility
            const rankGap = ownPosition !== null && competitorPosition !== null ? ownPosition - competitorPosition : 0
            const sentimentGap = ownSentiment !== null && competitorSentiment !== null ? competitorSentiment - ownSentiment : 0

            let type: OpportunityType | null = null
            if (ownVisibility === 0 && competitorVisibility > 0) type = "MISSING"
            else if (rankGap >= 0.75) type = "OUTRANKED"
            else if (sourceCount >= 2 && visibilityGap >= 8) type = "SOURCE_GAP"
            else if (sentimentGap >= 10) type = "SENTIMENT_GAP"
            else if (visibilityGap >= 18) type = "SOURCE_GAP"

            if (!type) continue

            opportunities.push(buildOpportunity({
                type,
                promptChats,
                prompt,
                brandName: project.brand_name,
                competitorName,
                ownVisibility,
                competitorVisibility,
                ownPosition,
                competitorPosition,
                ownSentiment,
                competitorSentiment,
                totalChats: total,
            }))
        }
    }

    const unique = Array.from(new Map(opportunities.map(item => [item.id, item])).values())
        .sort((a, b) => b.impact_score - a.impact_score)
        .slice(0, 60)

    return {
        summary: {
            total: unique.length,
            high_impact: unique.filter(item => item.impact === "HIGH").length,
            quick_wins: unique.filter(item => item.impact !== "LOW" && item.effort === "LOW").length,
            create_pages: unique.filter(item => item.content_gap.action === "CREATE").length,
            refresh_pages: unique.filter(item => item.content_gap.action === "REFRESH" || item.content_gap.action === "OPTIMIZE").length,
            competitor_gaps: unique.filter(item => item.type === "MISSING" || item.type === "OUTRANKED").length,
            source_gaps: unique.filter(item => item.type === "SOURCE_GAP").length,
            sentiment_gaps: unique.filter(item => item.type === "SENTIMENT_GAP").length,
        },
        opportunities: unique,
    }
}
