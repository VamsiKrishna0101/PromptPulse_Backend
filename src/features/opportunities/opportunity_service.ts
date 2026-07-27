import prisma from "../../lib/prisma"
import { buildChatWhere, type DashboardFilters } from "../dashboard/dashboard_service"
import type { ContentGapPlan, OpportunityBucket, OpportunityConfidence, OpportunityEffort, OpportunityImpact, OpportunityItem, OpportunitySource, OpportunityType, OpportunitiesResponse, SourceActionability } from "./opportunity_types"
import { classifyBuyerIntent } from "./buyer_intent"
import { outcomeExplanation, recommendationOutcome } from "./opportunity_outcome"
import { selectOpportunityTargetPage } from "./opportunity_targeting"
import { isEligibleCompetitorEntity, sameBrandEntity, sanitizeDiscoveredBrandName } from "../brands/brand_entity_policy"

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

function capImpactForConfidence(score: number, confidence: OpportunityConfidence) {
    if (confidence === "NEEDS_REVIEW") return Math.min(score, 34)
    if (confidence === "LOW") return Math.min(score, 41)
    if (confidence === "MEDIUM") return Math.min(score, 78)
    return score
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

function isNoisySearchResult(rawResponse: string | null) {
    if (!rawResponse) return false
    const text = rawResponse.toLowerCase()
    const signals = [
        /\b(videos?|youtube|people also ask|related searches|search results?|sponsored|key moments)\b/.test(text),
        /\b(view all|more results|results for|site links?)\b/.test(text),
        /(?:https?:\/\/|www\.)\S+/.test(text),
        /[a-z0-9-]+\.(com|ai|io|co|org|net|in)\s*[>\u203a]/i.test(rawResponse),
        (rawResponse.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},\s+\d{4}\b/gi) ?? []).length >= 2,
        (rawResponse.match(/\b(?:google|youtube|linkedin|reddit|g2|capterra)\.[a-z.]+\b/gi) ?? []).length >= 2,
    ]
    return signals.filter(Boolean).length >= 2
}

function hasCompetitorMention(chat: ChatWithEvidence, competitorName: string) {
    return chat.brand_mentions.some(mention => sameBrandEntity(mention.brand_name, competitorName))
}

function promptIntentWarning(promptText: string) {
    const text = promptText.toLowerCase()
    if (!/\bgeo\b/.test(text)) return null

    const aiIntent = /\b(ai visibility|generative engine|answer engine|llm|chatgpt|perplexity|ai search|ai overview|prompt)\b/.test(text)
    const geospatialIntent = /\b(gis|geospatial|map|maps|mapping|location intelligence|spatial|coordinates|wgs84)\b/.test(text)

    if (!aiIntent && !geospatialIntent) {
        return "Prompt intent is ambiguous: GEO could mean generative engine optimization or geospatial software."
    }
    if (aiIntent && geospatialIntent) {
        return "Prompt mixes AI visibility and geospatial language, so review the raw answer before creating competitor-specific content."
    }
    return null
}

function isLowSignalDomain(domain: string) {
    const normalized = domain.toLowerCase().replace(/^www\./, "")
    return /^google\./.test(normalized) || ["youtube.com", "youtu.be"].includes(normalized)
}

function normalizeDomain(domain: string) {
    return domain.toLowerCase().replace(/^www\./, "").trim()
}

function classifySource(domain: string, title: string | null, ownBrand: string, competitorName: string): {
    actionability: SourceActionability
    pattern: string
    recommended_action: string
} {
    const normalized = normalizeDomain(domain)
    const titleText = (title ?? "").toLowerCase()
    const own = ownBrand.toLowerCase().replace(/[^a-z0-9]+/g, "")
    const competitor = competitorName.toLowerCase().replace(/[^a-z0-9]+/g, "")
    const compactDomain = normalized.replace(/[^a-z0-9]+/g, "")

    const noisyDomains = [
        "google.", "chatgpt.com", "openai.com", "gemini.google.com", "perplexity.ai", "copilot.microsoft.com",
        "bing.com", "youtube.com", "youtu.be", "facebook.com", "instagram.com", "x.com", "twitter.com",
        "accounts.google.com", "login.", "cdn.", "cloudfront.net"
    ]
    if (noisyDomains.some(item => normalized.includes(item))) {
        return {
            actionability: "NOT_ACTIONABLE",
            pattern: "Platform / noisy source",
            recommended_action: "Monitor only. Do not spend time trying to influence this source directly.",
        }
    }

    if ((own && compactDomain.includes(own)) || (competitor && compactDomain.includes(competitor))) {
        return {
            actionability: "NOT_ACTIONABLE",
            pattern: compactDomain.includes(own) ? "Owned domain" : "Competitor-owned domain",
            recommended_action: compactDomain.includes(own)
                ? "Use this as proof your owned content is being found; improve the page if rank is weak."
                : "Monitor only. Do not try to publish on competitor-owned pages.",
        }
    }

    const highIntentDirectories = [
        "google.com/maps", "business.google.com", "practo.com", "justdial.com", "sulekha.com", "lybrate.com",
        "credihealth.com", "apollo247.com", "medindia.net", "mouthshut.com", "indiamart.com", "tradeindia.com",
        "g2.com", "capterra.com", "trustradius.com", "producthunt.com", "clutch.co", "goodfirms.co",
        "trustpilot.com", "softwareadvice.com"
    ]
    if (highIntentDirectories.some(item => normalized.includes(item))) {
        return {
            actionability: "HIGH",
            pattern: "Directory / review source",
            recommended_action: "Claim or optimize the profile, add services/categories, collect reviews, and keep NAP/proof details fresh.",
        }
    }

    const communityOrEditorial = [
        "reddit.com", "quora.com", "medium.com", "substack.com", "linkedin.com", "news18.com", "yourstory.com",
        "entrepreneur.com", "forbes.com", "inc.com", "economictimes.indiatimes.com", "timesofindia.indiatimes.com",
        "hindustantimes.com", "thehindu.com", "business-standard.com"
    ]
    if (communityOrEditorial.some(item => normalized.includes(item)) || /\b(best|top|compare|review|alternatives|guide)\b/.test(titleText)) {
        return {
            actionability: "MEDIUM",
            pattern: "Editorial / community source",
            recommended_action: "Earn mentions through useful comparisons, expert quotes, case studies, PR, or founder/community participation.",
        }
    }

    if (/\.(gov|edu)(\.|$)/.test(normalized) || normalized.endsWith(".gov.in") || normalized.endsWith(".edu.in") || titleText.includes("pdf")) {
        return {
            actionability: "LOW",
            pattern: "Authority reference",
            recommended_action: "Use as context and cite it in your own content. Direct influence is usually slow or not practical.",
        }
    }

    return {
        actionability: "MEDIUM",
        pattern: "Relevant web source",
        recommended_action: "Review whether the page accepts updates, citations, partnerships, comments, listings, or source-backed outreach.",
    }
}

function actionabilityWeight(actionability: SourceActionability) {
    if (actionability === "HIGH") return 4
    if (actionability === "MEDIUM") return 3
    if (actionability === "LOW") return 2
    return 1
}

function overallActionability(sources: OpportunitySource[], type: OpportunityType): SourceActionability {
    if (sources.some(source => source.actionability === "HIGH")) return "HIGH"
    if (sources.some(source => source.actionability === "MEDIUM")) return "MEDIUM"
    if (type === "MISSING") return "MEDIUM"
    if (sources.some(source => source.actionability === "LOW")) return "LOW"
    return "NOT_ACTIONABLE"
}

function opportunityBucket(input: {
    type: OpportunityType
    effort: OpportunityEffort
    impact: OpportunityImpact
    actionability: SourceActionability
    sources: OpportunitySource[]
    confidence: OpportunityConfidence
}): OpportunityBucket {
    if (input.confidence === "NEEDS_REVIEW" || input.actionability === "NOT_ACTIONABLE") return "MONITOR"
    if (input.impact !== "LOW" && input.effort === "LOW" && (input.actionability === "HIGH" || input.type === "MISSING")) return "QUICK_WIN"
    if (input.type === "SOURCE_GAP" || input.sources.some(source => source.actionability === "HIGH")) return "SOURCE_GAP"
    if (input.sources.some(source => source.actionability === "LOW")) return "AUTHORITY_GAP"
    return "CONTENT_GAP"
}

function sourcePattern(sources: OpportunitySource[]) {
    if (!sources.length) return null
    const best = [...sources].sort((a, b) => {
        const actionGap = actionabilityWeight(b.actionability) - actionabilityWeight(a.actionability)
        if (actionGap) return actionGap
        return b.mentions - a.mentions
    })[0]
    if (!best) return null
    const rank = best.avg_rank ? ` around rank #${best.avg_rank}` : ""
    return `${best.source_type ?? "Source"} pattern: ${best.domain} appears ${best.mentions} time${best.mentions === 1 ? "" : "s"}${rank}.`
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
    canUseCompetitor: boolean
    promptWarning: string | null
}) {
    const sourceDomains = input.sources.slice(0, 2).map(source => source.domain)
    const angles = new Set<string>()

    if (input.type === "MISSING") {
        angles.add("Direct answer to the prompt intent")
        if (input.canUseCompetitor) angles.add(`Why buyers compare you with ${input.competitorName}`)
        else angles.add("Buyer criteria: pricing, features, use cases, and proof")
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

    if (input.promptWarning) angles.add("Clarified prompt intent before writing")
    angles.add("Short FAQ answers for AI snippets")
    return Array.from(angles).slice(0, 4)
}

function optimizationFocus(type: OpportunityType, sources: OpportunitySource[] = []) {
    if (sources.some(source => source.actionability === "HIGH")) {
        return ["Optimize high-actionability profiles", "Add review proof", "Match service/category language"]
    }
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
    confidence: OpportunityConfidence
    confidenceReasons: string[]
    cleanEvidenceCount: number
    promptWarning: string | null
}): ContentGapPlan {
    const action = contentAction(input.type)
    const contentType = inferContentType(input.promptText, input.type)
    const sourceLabel = input.sources.length ? ` Sources like ${input.sources.slice(0, 2).map(source => source.domain).join(" and ")} are reinforcing competitor answers.` : ""
    const canUseCompetitor = input.confidence === "HIGH" || (input.confidence === "MEDIUM" && input.cleanEvidenceCount >= 2)
    const gapReason = input.promptWarning
        ? `${input.promptWarning} Treat this as a review item before writing competitor-specific copy.`
        : input.cleanEvidenceCount === 0
            ? `Detected competitor visibility is based on low-confidence answer evidence. Review the raw chats before acting.`
            : input.type === "MISSING"
                ? `${input.competitorName} appears for this intent while ${input.brandName} is missing or weak.`
                : `${input.competitorName} has stronger AI-answer evidence for this intent.${sourceLabel}`

    return {
        gap_reason: gapReason,
        recommended_content_type: contentType,
        suggested_title: suggestedTitle(input.promptText, input.brandName, input.type),
        action,
        priority_reason: `Impact score ${input.impactScore}; confidence ${input.confidence.toLowerCase()}; competitor visibility ${rounded(input.competitorVisibility)}% vs your ${rounded(input.ownVisibility)}%.`,
        missing_angles: missingAngles({ type: input.type, competitorName: input.competitorName, sources: input.sources, canUseCompetitor, promptWarning: input.promptWarning }),
        optimization_focus: optimizationFocus(input.type, input.sources),
        source_actions: input.sources
            .filter(source => source.actionability !== "NOT_ACTIONABLE")
            .slice(0, 3)
            .map(source => `${source.domain}: ${source.recommended_action}`),
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

function nextStep(input: {
    type: OpportunityType
    competitor: string
    sources: OpportunitySource[]
    confidence: OpportunityConfidence
    cleanEvidenceCount: number
    promptWarning: string | null
}) {
    const canUseCompetitor = input.confidence === "HIGH" || (input.confidence === "MEDIUM" && input.cleanEvidenceCount >= 2)

    if (input.promptWarning) {
        return "Clarify whether this prompt means AI visibility/GEO or geospatial SaaS before creating content. If targeting AI visibility, create a focused best-tools page with pricing/value, supported engines, FAQs, and credible citations."
    }
    if (input.cleanEvidenceCount === 0) {
        return "Review the raw answers first. If the competitor mention is valid, create a focused page that answers the prompt with buyer criteria, pricing/value, proof, FAQs, and credible citations."
    }
    if (input.type === "SOURCE_GAP" && input.sources.length) {
        const actionable = input.sources.find(source => source.actionability === "HIGH" || source.actionability === "MEDIUM") ?? input.sources[0]
        return `Prioritize ${actionable.domain}: ${actionable.recommended_action}`
    }
    if (input.type === "MISSING" && canUseCompetitor) {
        return `Create or refresh a page that directly answers this prompt, then make sure ${input.competitor} comparison language is covered honestly.`
    }
    if (input.type === "OUTRANKED" && canUseCompetitor) {
        return `Strengthen the prompt intent with clearer positioning, proof points, and comparison copy against ${input.competitor}.`
    }
    return "Create or refresh a focused page that directly answers this prompt, covers buyer criteria, pricing/value, use cases, proof, FAQs, and cites credible sources."
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
                    type: true,
                }
            },
            brand_mentions: {
                select: {
                    brand_name: true,
                    domain: true,
                    position: true,
                    sentiment_score: true,
                }
            },
            sources: {
                select: {
                    url: true,
                    domain: true,
                    title: true,
                    source_type: true,
                    is_cited: true,
                    source_kind: true,
                    source_position: true,
                    answer_position: true,
                }
            }
        },
        orderBy: { created_at: "desc" },
    })
}

function cleanCompetitorChats(chats: ChatWithEvidence[], competitorName: string) {
    return chats.filter(chat => hasCompetitorMention(chat, competitorName) && !isNoisySearchResult(chat.raw_response))
}

function confidenceForOpportunity(input: {
    promptWarning: string | null
    totalChats: number
    cleanEvidenceCount: number
    evidenceCount: number
    sourceCount: number
    noisyEvidenceCount: number
}) {
    const reasons: string[] = []
    let confidence: OpportunityConfidence = "HIGH"

    if (input.promptWarning) reasons.push(input.promptWarning)
    if (input.cleanEvidenceCount === 0) reasons.push("Competitor appears only in noisy or low-confidence answer evidence.")
    if (input.noisyEvidenceCount > 0) reasons.push(`${input.noisyEvidenceCount} answer${input.noisyEvidenceCount === 1 ? "" : "s"} look like search-result scrape noise.`)
    if (input.sourceCount === 0) reasons.push("No clean cited source pattern supports this competitor gap yet.")
    if (input.evidenceCount < 2) reasons.push("Only one matching answer supports this opportunity.")

    if (input.promptWarning || input.cleanEvidenceCount === 0) confidence = "NEEDS_REVIEW"
    else if (input.cleanEvidenceCount === 1 || input.evidenceCount < 3 || input.sourceCount === 0) confidence = "LOW"
    else if (input.cleanEvidenceCount < Math.max(2, Math.ceil(input.totalChats * 0.4))) confidence = "MEDIUM"

    return {
        confidence,
        reasons: reasons.slice(0, 3),
    }
}

function sourceEvidence(chats: ChatWithEvidence[], competitorName: string, brandName: string, cleanOnly = false): OpportunitySource[] {
    const domainMap = new Map<string, OpportunitySource & { rankTotal: number; rankCount: number }>()

    for (const chat of chats) {
        const competitorWasMentioned = hasCompetitorMention(chat, competitorName)
        if (!competitorWasMentioned) continue
        if (cleanOnly && isNoisySearchResult(chat.raw_response)) continue

        const uniqueDomains = new Set<string>()
        for (const source of chat.sources) {
            if (!source.domain || uniqueDomains.has(source.domain)) continue
            if (cleanOnly && isLowSignalDomain(source.domain)) continue
            uniqueDomains.add(source.domain)
            const existing = domainMap.get(source.domain)
            const classified = classifySource(source.domain, source.title, brandName, competitorName)
            const rank = source.answer_position ?? source.source_position ?? null
            domainMap.set(source.domain, {
                domain: source.domain,
                url: existing?.url ?? source.url ?? null,
                title: existing?.title ?? source.title ?? null,
                source_type: existing?.source_type ?? source.source_type ?? classified.pattern,
                mentions: (existing?.mentions ?? 0) + 1,
                citations: (existing?.citations ?? 0) + (source.is_cited ? 1 : 0),
                avg_rank: null,
                source_kind: existing?.source_kind ?? source.source_kind ?? null,
                actionability: existing?.actionability ?? classified.actionability,
                recommended_action: existing?.recommended_action ?? classified.recommended_action,
                rankTotal: (existing?.rankTotal ?? 0) + (rank ?? 0),
                rankCount: (existing?.rankCount ?? 0) + (rank !== null ? 1 : 0),
            })
        }
    }

    return Array.from(domainMap.values())
        .map(source => ({
            domain: source.domain,
            url: source.url,
            title: source.title,
            source_type: source.source_type,
            mentions: source.mentions,
            citations: source.citations,
            avg_rank: source.rankCount ? rounded(source.rankTotal / source.rankCount) : null,
            source_kind: source.source_kind,
            actionability: source.actionability,
            recommended_action: source.recommended_action,
        }))
        .sort((a, b) => {
            const actionGap = actionabilityWeight(b.actionability) - actionabilityWeight(a.actionability)
            if (actionGap) return actionGap
            const citationGap = b.citations - a.citations
            if (citationGap) return citationGap
            return b.mentions - a.mentions
        })
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
    brandUrl: string
    sitePages: Array<{
        url: string
        title: string | null
        h1: string | null
        detected_services: unknown
        detected_locations: unknown
    }>
}): OpportunityItem {
    const sources = sourceEvidence(input.promptChats, input.competitorName, input.brandName, true)
    const cleanChats = cleanCompetitorChats(input.promptChats, input.competitorName)
    const noisyEvidenceCount = input.promptChats.filter(chat => hasCompetitorMention(chat, input.competitorName) && isNoisySearchResult(chat.raw_response)).length
    const promptWarning = promptIntentWarning(input.prompt.text)
    const confidenceResult = confidenceForOpportunity({
        promptWarning,
        totalChats: input.totalChats,
        cleanEvidenceCount: cleanChats.length,
        evidenceCount: input.totalChats,
        sourceCount: sources.length,
        noisyEvidenceCount,
    })
    const visibilityGap = Math.max(0, input.competitorVisibility - input.ownVisibility)
    const rankGap = input.ownPosition && input.competitorPosition ? Math.max(0, input.ownPosition - input.competitorPosition) * 8 : 0
    const sentimentGap = input.ownSentiment && input.competitorSentiment ? Math.max(0, input.competitorSentiment - input.ownSentiment) * 0.4 : 0
    const evidenceBoost = Math.min(16, input.totalChats * 3)
    const rawImpactScore = Math.min(100, Math.round(visibilityGap * 1.15 + rankGap + sentimentGap + evidenceBoost + sources.length * 3))
    const impactScore = capImpactForConfidence(rawImpactScore, confidenceResult.confidence)
    const effort = effortFor(input.type, sources.filter(source => source.actionability !== "NOT_ACTIONABLE").length)
    const actionability = overallActionability(sources, input.type)
    const impact = impactLabel(impactScore)
    const bucket = opportunityBucket({
        type: input.type,
        effort,
        impact,
        actionability,
        sources,
        confidence: confidenceResult.confidence,
    })
    const sample = input.promptChats.find(chat =>
        hasCompetitorMention(chat, input.competitorName)
    )?.raw_response
    const buyerIntent = classifyBuyerIntent(input.prompt.text, input.prompt.type)
    const brandOutcome = recommendationOutcome({
        visibility: input.ownVisibility,
        position: input.ownPosition,
        sentiment: input.ownSentiment,
    })
    const competitorOutcome = recommendationOutcome({
        visibility: input.competitorVisibility,
        position: input.competitorPosition,
        sentiment: input.competitorSentiment,
    })
    const contentGap = buildContentGapPlan({
        type: input.type,
        promptText: input.prompt.text,
        brandName: input.brandName,
        competitorName: input.competitorName,
        ownVisibility: input.ownVisibility,
        competitorVisibility: input.competitorVisibility,
        sources,
        impactScore,
        confidence: confidenceResult.confidence,
        confidenceReasons: confidenceResult.reasons,
        cleanEvidenceCount: cleanChats.length,
        promptWarning,
    })
    const targetPage = selectOpportunityTargetPage({
        promptText: input.prompt.text,
        topic: input.prompt.topic,
        action: contentGap.action,
        brandUrl: input.brandUrl,
        pages: input.sitePages,
    })
    if (targetPage.status === "EXISTING_PAGE" && contentGap.action === "CREATE") {
        contentGap.action = "OPTIMIZE"
        contentGap.priority_reason = `${contentGap.priority_reason} A relevant owned page already exists, so optimize that page instead of creating a duplicate.`
    }
    const supportingUrls = [...new Set(sources.map(source => source.url).filter((url): url is string => Boolean(url)))].slice(0, 5)

    return {
        id: `${input.prompt.id}-${input.competitorName}-${input.type}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        type: input.type,
        title: opportunityTitle(input.type, input.competitorName),
        description: opportunityDescription(input),
        prompt_id: input.prompt.id,
        prompt_text: input.prompt.text,
        topic: input.prompt.topic,
        buyer_intent: buyerIntent,
        competitor_name: input.competitorName,
        brand_outcome: brandOutcome,
        competitor_outcome: competitorOutcome,
        outcome_explanation: outcomeExplanation(brandOutcome),
        own_visibility: rounded(input.ownVisibility),
        competitor_visibility: rounded(input.competitorVisibility),
        own_position: input.ownPosition ? rounded(input.ownPosition) : null,
        competitor_position: input.competitorPosition ? rounded(input.competitorPosition) : null,
        own_sentiment: input.ownSentiment ? rounded(input.ownSentiment) : null,
        competitor_sentiment: input.competitorSentiment ? rounded(input.competitorSentiment) : null,
        impact_score: impactScore,
        impact,
        effort,
        evidence_count: input.totalChats,
        clean_evidence_count: cleanChats.length,
        confidence: confidenceResult.confidence,
        confidence_reasons: confidenceResult.reasons,
        prompt_intent_warning: promptWarning,
        opportunity_bucket: bucket,
        actionability,
        source_pattern: sourcePattern(sources),
        top_sources: sources,
        content_gap: contentGap,
        target_page: targetPage,
        supporting_urls: supportingUrls,
        business_reason: buyerIntent.value === "HIGH"
            ? `This ${buyerIntent.label.toLowerCase()} prompt can influence a near-term buyer decision. ${input.competitorName} currently has the stronger AI outcome.`
            : `This prompt shapes ${buyerIntent.stage.toLowerCase()} visibility and can influence which brands enter the buyer's shortlist.`,
        verification: {
            baseline: {
                visibility: rounded(input.ownVisibility),
                position: input.ownPosition ? rounded(input.ownPosition) : null,
                outcome: brandOutcome,
            },
            success_metric: brandOutcome === "ABSENT"
                ? "Move from absent to listed or recommended in the tracked AI answers."
                : `Improve visibility above ${rounded(input.ownVisibility)}% or average position above ${input.ownPosition ? `#${rounded(input.ownPosition)}` : "the current baseline"}.`,
            recheck_after_days: contentGap.action === "CREATE" ? 14 : 7,
        },
        next_step: nextStep({
            type: input.type,
            competitor: input.competitorName,
            sources,
            confidence: confidenceResult.confidence,
            cleanEvidenceCount: cleanChats.length,
            promptWarning,
        }),
        sample_response: sample ? cleanText(sample, 320) : null,
    }
}

export async function getOpportunities(project_id: string, filters: DashboardFilters = {}): Promise<OpportunitiesResponse> {
    const [project, chats] = await Promise.all([
        prisma.project.findUniqueOrThrow({
            where: { id: project_id },
            include: {
                competitors: { select: { name: true } },
                seo_audits: {
                    take: 1,
                    orderBy: { created_at: "desc" },
                    select: {
                        pages: {
                            select: {
                                url: true,
                                title: true,
                                h1: true,
                                detected_services: true,
                                detected_locations: true,
                            },
                        },
                    },
                },
            }
        }),
        loadOpportunityChats(project_id, filters)
    ])

    if (!chats.length) {
        return {
            summary: { total: 0, high_impact: 0, quick_wins: 0, create_pages: 0, refresh_pages: 0, competitor_gaps: 0, source_gaps: 0, sentiment_gaps: 0 },
            opportunities: []
        }
    }

    const trackedCompetitors = project.competitors.map(competitor => competitor.name)
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
                const name = sanitizeDiscoveredBrandName(mention.brand_name)
                if (!name || !isEligibleCompetitorEntity({
                    name,
                    domain: mention.domain,
                    ownBrandName: project.brand_name,
                    ownBrandUrl: project.brand_url,
                })) continue

                const trackedName = trackedCompetitors.find(competitor => sameBrandEntity(name, competitor))
                if (trackedCompetitors.length && !trackedName) continue
                const canonicalName = trackedName ?? name
                const canonicalKey = canonicalName.toLowerCase()
                if (seenInChat.has(canonicalKey)) continue
                seenInChat.add(canonicalKey)

                const current = competitorMap.get(canonicalName) ?? { count: 0, positions: [], sentiments: [] }
                current.count += 1
                if (mention.position !== null) current.positions.push(mention.position)
                if (mention.sentiment_score !== null) current.sentiments.push(mention.sentiment_score)
                competitorMap.set(canonicalName, current)
            }
        }

        for (const [competitorName, competitor] of competitorMap.entries()) {
            const competitorVisibility = (competitor.count / total) * 100
            const competitorPosition = avg(competitor.positions)
            const competitorSentiment = avg(competitor.sentiments)
            const sourceCount = sourceEvidence(promptChats, competitorName, project.brand_name, true).filter(source => source.actionability !== "NOT_ACTIONABLE").length
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
                brandUrl: project.brand_url,
                sitePages: project.seo_audits[0]?.pages ?? [],
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
