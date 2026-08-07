import { GoogleGenerativeAI } from '@google/generative-ai'
import axios from 'axios'
import https from 'https'
import { buildBrandPromptGenerationSystemPrompt, buildBrandPromptGenerationUserPrompt } from '../../prompts/brand_prompts'
import { buildAnalysisSystemPrompt, buildAnalysisUserPrompt, type AnalysisResult } from '../../prompts/analysis_prompts'
import { buildBrandResearchSystemPrompt, buildBrandResearchUserPrompt, type BrandResearchResult } from '../../prompts/research_prompts'
import { generateWithBedrockGateway, hasBedrockGateway } from './bedrock_gateway_service'
import { isEligibleCompetitorEntity, normalizeEntityDomain, sanitizeDiscoveredBrandName } from '../brands/brand_entity_policy'
import { normalizeStrictBrandName } from '../brands/strict_brand_matcher'
import { analyzeUiAnswerWithKimi } from './analysis/kimi_analysis_service'

const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const model = genai.getGenerativeModel({ model: 'gemini-3.1-flash-lite' })
const embeddingModel = genai.getGenerativeModel({
    model: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001'
})
const GROQ_ANALYSIS_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'

export async function embedText(text: string): Promise<number[]> {
    const cleanText = text.replace(/\s+/g, ' ').trim()
    if (!cleanText) {
        throw new Error('Cannot embed empty text.')
    }

    const values = await embedTextWithRest(cleanText)

    if (!values.length) {
        throw new Error('Gemini returned an empty embedding.')
    }

    return values
}

export async function generateText(systemPrompt: string, userPrompt: string): Promise<string> {
    if (hasBedrockGateway()) {
        return generateWithBedrockGateway(systemPrompt, userPrompt)
    }
    return generateTextWithRest(systemPrompt, userPrompt)
}

export async function generateTextStream(
    systemPrompt: string,
    userPrompt: string,
    onChunk: (chunk: string) => void
): Promise<string> {
    try {
        const result = await model.generateContentStream([
            { text: systemPrompt },
            { text: userPrompt },
        ])

        let fullText = ''
        for await (const chunk of result.stream) {
            const text = chunk.text()
            if (!text) continue
            fullText += text
            onChunk(text)
        }

        const trimmed = fullText.trim()
        if (!trimmed) {
            throw new Error('Gemini streaming generation returned an empty response.')
        }

        return trimmed
    } catch (error) {
        console.warn('Gemini streaming failed. Falling back to non-streamed response.', error)
        const text = await generateText(systemPrompt, userPrompt)
        for (const chunk of chunkForFallbackStream(text)) {
            onChunk(chunk)
        }
        return text
    }
}

export async function generateBrandPrompts(
    brand_name: string,
    brand_url: string,
    brand_data: Record<string, unknown>
): Promise<{ prompts: { topic: string; type: string; text: string }[] }> {
    const systemPrompt = buildBrandPromptGenerationSystemPrompt()
    const userPrompt = buildBrandPromptGenerationUserPrompt(brand_name, brand_url, brand_data)

    try {
        const result = await model.generateContent([
            { text: systemPrompt },
            { text: userPrompt },
        ])

        return parseJson<{ prompts: { topic: string; type: string; text: string }[] }>(result.response.text())
    } catch (error) {
        console.error('[generateBrandPrompts] Gemini failed — no fallback available:', error)
        throw new Error(
            error instanceof Error
                ? `Prompt generation failed: ${error.message}`
                : 'Prompt generation failed: Gemini returned no usable response.'
        )
    }
}

export async function summarizeBrandResearch(
    brand_name: string,
    brand_url: string,
    crawl_data: Record<string, unknown>
): Promise<BrandResearchResult> {
    const systemPrompt = buildBrandResearchSystemPrompt()
    const userPrompt = buildBrandResearchUserPrompt(brand_name, brand_url, crawl_data)

    if (hasBedrockGateway()) {
        return parseJson<BrandResearchResult>(
            await generateWithBedrockGateway(systemPrompt, userPrompt, {
                temperature: 0.2,
                maxTokens: 8192,
                responseFormat: "json_object",
            })
        )
    }

    try {
        const result = await model.generateContent([
            { text: systemPrompt },
            { text: userPrompt },
        ])

        return parseJson<BrandResearchResult>(result.response.text())
    } catch (error) {
        console.warn('Gemini brand research summary failed. Falling back to Groq.', error)
        return summarizeBrandResearchWithGroq(systemPrompt, userPrompt)
    }
}

export async function analyzeResponse(
    raw_response: string,
    ai_model: string,
    brand_name: string,
    brand_url: string,
    citations?: { url?: string | null; domain?: string | null; title?: string | null; text?: string | null; is_cited?: boolean | null; source_kind?: string | null }[]
): Promise<AnalysisResult & { ai_model: string }> {
    const systemPrompt = buildAnalysisSystemPrompt()
    const userPrompt = buildAnalysisUserPrompt(raw_response, brand_name, brand_url, citations)

    if (hasBedrockGateway()) {
        const parsed = await analyzeUiAnswerWithKimi({
            uiAnswer: raw_response,
            sourceModel: ai_model,
            brandName: brand_name,
            brandUrl: brand_url,
            citations,
        })
        return { ...normalizeAnalysisResult(parsed, raw_response, brand_name, brand_url, citations), ai_model }
    }

    if (
        process.env.NODE_ENV === "production"
        || process.env.KIMI_ANALYSIS_REQUIRED?.trim().toLowerCase() === "true"
    ) {
        throw new Error(
            "Kimi analysis is required but the Bedrock gateway is not configured. "
            + "Configure a supported Bedrock gateway credential on this runtime."
        )
    }

    // Local development may still use the legacy providers when explicitly run
    // without Bedrock credentials. Production never silently bypasses Kimi.
    try {
        const result = await model.generateContent([
            { text: systemPrompt },
            { text: userPrompt },
        ])

        const parsed = parseJson<AnalysisResult>(result.response.text())
        return { ...normalizeAnalysisResult(parsed, raw_response, brand_name, brand_url, citations), ai_model }
    } catch (error) {
        console.warn('Gemini analysis failed. Falling back to Groq.', error)
        const parsed = await analyzeResponseWithGroq(systemPrompt, userPrompt)
        return { ...normalizeAnalysisResult(parsed, raw_response, brand_name, brand_url, citations), ai_model }
    }
}

/**
 * Tries to salvage a JSON string that was truncated mid-way.
 *
 * Strategy:
 * 1. Remove the last (incomplete) key–value pair by walking back to the last
 *    complete comma or opening brace.
 * 2. Close the object with }.
 * 3. Parse again — if it still fails, throw the original error.
 */
function repairTruncatedJson(raw: string): unknown {
    // Try progressively shorter slices until we get a valid object
    let attempt = raw.trim()

    // Remove trailing partial string — find the last correctly terminated string value
    // by working backwards from the end
    for (let cutAt = attempt.length - 1; cutAt > 10; cutAt--) {
        const ch = attempt[cutAt]
        // Look for a position that is either after a closing " or after a comma/digit/bool
        if (ch === ',' || ch === '{') {
            const candidate = attempt.slice(0, cutAt) + '}'
            try {
                return JSON.parse(candidate)
            } catch {
                // keep trimming
            }
        }
    }

    throw new SyntaxError(`Could not repair truncated JSON (length=${raw.length})`)
}

function parseJson<T>(raw: string | undefined | null): T {
    if (!raw) throw new Error('LLM returned an empty response — content may have been blocked or the model hit a token limit.')
    const cleaned = raw
        .trim()
        .replace(/^```json\n?/i, '')
        .replace(/^```\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim()

    try {
        return JSON.parse(cleaned) as T
    } catch (firstError) {
        // The JSON was likely truncated (LLM hit output token limit).
        // Try to recover the partial object — at minimum we can get brands/sources
        try {
            console.warn('[parseJson] JSON truncated — attempting repair', {
                length: cleaned.length,
                tail: cleaned.slice(-120),
            })
            return repairTruncatedJson(cleaned) as T
        } catch {
            throw firstError // re-throw the original error for the outer catch
        }
    }
}

function normalizeAnalysisResult(
    analysis: AnalysisResult,
    rawResponse: string,
    brandName: string,
    brandUrl: string,
    citations: { url?: string | null; domain?: string | null; title?: string | null; text?: string | null; is_cited?: boolean | null; source_kind?: string | null }[] = []
): AnalysisResult {
    const normalizedBrandMentions = dedupeBrandMentions([
        ...analysis.brand_mentions,
        ...extractKnownBrandMentions(rawResponse),
    ], citations, brandName, brandUrl)
    const semanticTrackedMention = normalizedBrandMentions.find(
        mention => mention.entity_type === "TRACKED_BRAND"
    )
    const brandMentioned = Boolean(analysis.brand_mentioned || semanticTrackedMention)

    if (brandMentioned && !semanticTrackedMention) {
        normalizedBrandMentions.push({
            brand_name: brandName,
            canonical_brand_name: brandName,
            domain: safeDomain(brandUrl),
            entity_type: "TRACKED_BRAND",
            position: analysis.brand_position ?? null,
            sentiment_score: analysis.sentiment_score ?? null,
            evidence: analysis.matched_brand_name ?? null,
        })
    }
    const trackedMention = normalizedBrandMentions.find(
        mention => mention.entity_type === "TRACKED_BRAND"
    )

    const citationSources = citations
        .filter(citation => citation.url)
        .map(citation => ({
            url: citation.url!,
            domain: citation.domain || safeDomain(citation.url) || citation.url!,
            source_type: classifySourceDomain(
                citation.domain || safeDomain(citation.url) || citation.url!,
                brandUrl,
                normalizedBrandMentions.map(mention => mention.brand_name)
            ),
            is_cited: citation.is_cited ?? (citation.source_kind === "citation" || citation.source_kind === "attached_link"),
        } satisfies AnalysisResult["sources"][number]))

    const explicitDomains = extractExplicitDomains(rawResponse)

    // Detect forum community citations: "r/SaaS", "r/MachineLearning" → reddit.com; "Quora" → quora.com
    const forumSources: AnalysisResult["sources"] = []
    if (/\br\/[A-Za-z0-9_]+\b/.test(rawResponse)) {
        forumSources.push({
            url: "https://reddit.com",
            domain: "reddit.com",
            source_type: "UGC",
            is_cited: true,
        })
    }
    if (/\bquora\.com\b|\bQuora\b/i.test(rawResponse)) {
        forumSources.push({
            url: "https://quora.com",
            domain: "quora.com",
            source_type: "UGC",
            is_cited: true,
        })
    }

    const normalizedSources = dedupeSources([
        ...citationSources,
        ...forumSources,
        ...analysis.sources.filter(source => {
            if (!source.url && !source.domain) return false
            if (isAiEngineDomain(source.domain || source.url)) return false
            if (source.is_cited) return true
            return explicitDomains.has(normalizeDomain(source.domain)) || Boolean(source.url && rawResponse.includes(source.url))
        })
    ])

    return {
        ...analysis,
        brand_mentioned: brandMentioned,
        brand_position: brandMentioned
            ? analysis.brand_position ?? trackedMention?.position ?? null
            : null,
        sentiment_score: brandMentioned
            ? analysis.sentiment_score ?? trackedMention?.sentiment_score ?? null
            : null,
        brand_mentions: normalizedBrandMentions,
        sources: normalizedSources,
    }
}

function dedupeBrandMentions(
    mentions: AnalysisResult["brand_mentions"],
    citations: { url?: string | null; domain?: string | null; title?: string | null }[] = [],
    trackedBrandName = "",
    trackedBrandUrl = "",
) {
    const seen = new Set<string>()
    const normalized: AnalysisResult["brand_mentions"] = []
    for (const mention of mentions) {
        const sanitizedName = sanitizeDiscoveredBrandName(mention.brand_name)
        if (!sanitizedName) continue
        const isTrackedBrand = mention.entity_type === "TRACKED_BRAND"
            || normalizeBrandKey(sanitizedName) === normalizeBrandKey(trackedBrandName)
        const brandName = isTrackedBrand
            ? trackedBrandName
            : canonicalBrandName(mention.canonical_brand_name || sanitizedName)
        if (
            !isTrackedBrand
            && mention.entity_type
            && mention.entity_type !== "COMPETITOR"
        ) continue
        if (
            !isTrackedBrand
            && !isEligibleCompetitorEntity({
                name: brandName,
                ownBrandName: trackedBrandName,
                ownBrandUrl: trackedBrandUrl,
            })
        ) continue

        const key = normalizeBrandKey(brandName)
        if (!key || seen.has(key)) continue
        seen.add(key)
        normalized.push({
            ...mention,
            brand_name: brandName,
            canonical_brand_name: brandName,
            entity_type: isTrackedBrand ? "TRACKED_BRAND" : "COMPETITOR",
            domain: isTrackedBrand
                ? safeDomain(trackedBrandUrl)
                : resolveOfficialCompetitorDomain(
                    brandName,
                    mention.domain,
                    citations,
                    trackedBrandName,
                    trackedBrandUrl,
                ),
        })
    }
    return normalized
}

function resolveOfficialCompetitorDomain(
    brandName: string,
    modelDomain: string | null | undefined,
    citations: { url?: string | null; domain?: string | null; title?: string | null }[],
    trackedBrandName: string,
    trackedBrandUrl: string,
) {
    const candidates = [
        modelDomain,
        domainFromCitations(brandName, citations),
        knownBrandDomain(brandName),
    ]

    for (const candidate of candidates) {
        const domain = normalizeEntityDomain(candidate)
        if (!domain || !domain.includes(".") || !/^[a-z0-9.-]+$/.test(domain)) continue
        if (!isEligibleCompetitorEntity({
            name: brandName,
            domain,
            ownBrandName: trackedBrandName,
            ownBrandUrl: trackedBrandUrl,
        })) continue
        return domain
    }

    return null
}

function extractKnownBrandMentions(rawResponse: string): AnalysisResult["brand_mentions"] {
    const detected = KNOWN_BRANDS
        .map(brand => {
            const indexes = [brand.name, ...(brand.aliases ?? [])]
                .map(alias => firstVisibleMentionIndex(rawResponse, alias))
                .filter((index): index is number => index !== null)
            const firstIndex = indexes.length ? Math.min(...indexes) : null
            return firstIndex === null ? null : { brand, firstIndex }
        })
        .filter((item): item is { brand: KnownBrand; firstIndex: number } => Boolean(item))
        .sort((a, b) => a.firstIndex - b.firstIndex)

    return detected.map((item, index) => ({
        brand_name: item.brand.name,
        domain: item.brand.domain,
        position: index + 1,
        sentiment_score: 50,
    }))
}

function firstVisibleMentionIndex(text: string, brandName: string) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(brandName)}([^a-z0-9]|$)`, "i")
    const match = pattern.exec(text)
    if (!match) return null
    return match.index + (match[1]?.length ?? 0)
}

function dedupeSources(sources: AnalysisResult["sources"]) {
    const byKey = new Map<string, AnalysisResult["sources"][number]>()
    for (const source of sources) {
        const url = source.url?.trim() || ""
        const domain = normalizeDomain(source.domain || safeDomain(url) || url)
        if (!domain) continue

        const key = url || domain
        const existing = byKey.get(key)
        if (!existing || (!existing.is_cited && source.is_cited)) {
            byKey.set(key, {
                url,
                domain,
                source_type: source.source_type || "OTHER",
                is_cited: Boolean(source.is_cited),
            })
        }
    }
    return Array.from(byKey.values())
}

function extractExplicitDomains(text: string) {
    const domains = new Set<string>()
    const matches = text.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s]*)?/gi)
    for (const match of matches) {
        domains.add(normalizeDomain(match[1]))
    }
    return domains
}

function normalizeDomain(domain: string | null | undefined) {
    return (domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].trim()
}

function safeDomain(url: string | null | undefined) {
    if (!url) return null
    try {
        return new URL(url).hostname.replace(/^www\./, "")
    } catch {
        return normalizeDomain(url) || null
    }
}

function normalizeBrandDomain(domain: string | null | undefined) {
    const normalized = normalizeDomain(domain)
    return normalized || null
}

function domainFromCitations(
    brandName: string,
    citations: { url?: string | null; domain?: string | null; title?: string | null }[]
) {
    const brandKey = brandName.toLowerCase().replace(/[^a-z0-9]/g, "")
    for (const citation of citations) {
        const domain = normalizeDomain(citation.domain || safeDomain(citation.url))
        const titleKey = (citation.title || "").toLowerCase().replace(/[^a-z0-9]/g, "")
        const rootKey = domain.split(".")[0]?.replace(/[^a-z0-9]/g, "") || ""
        if (brandKey && (brandKey === titleKey || brandKey === rootKey || titleKey.includes(brandKey) || brandKey.includes(rootKey))) {
            return domain
        }
    }
    return null
}

function classifySourceDomain(domainOrUrl: string, brandUrl: string, mentionedBrands: string[]) {
    const domain = normalizeDomain(domainOrUrl)
    const ownDomain = normalizeDomain(safeDomain(brandUrl) || brandUrl)

    // Own brand
    if (domain && ownDomain && domain === ownDomain) return "YOU" as const

    // Known UGC platforms (closed, finite list — appropriate)
    if (/\b(reddit|quora|trustpilot|producthunt|g2crowd|glassdoor|yelp|tripadvisor)\b/.test(domain)) return "UGC" as const

    // Known social platforms (closed, finite list — appropriate)
    if (/\b(linkedin|twitter|x\.com|youtube|instagram|facebook|tiktok|pinterest|snapchat|threads)\b/.test(domain)) return "SOCIAL" as const

    // Reference / encyclopedic (closed, finite list — appropriate)
    if (/\b(wikipedia|wikidata|investopedia|britannica|scholarpedia|imdb)\b/.test(domain)) return "REFERENCE" as const

    // Institutional by TLD
    if (domain.endsWith(".gov") || domain.endsWith(".edu") || domain.includes(".gov.") || domain.includes(".edu.")) return "INSTITUTIONAL" as const

    // G2 / Capterra / software review platforms
    if (/\b(g2\.com|capterra|softwareadvice|getapp|crozdesk|sourceforge|alternativeto)\b/.test(domain)) return "REFERENCE" as const

    // Competitor check via known brand mapping
    const brandRoots = mentionedBrands
        .map(brand => knownBrandDomain(brand))
        .filter((value): value is string => Boolean(value))
        .map(value => normalizeDomain(value))
    if (brandRoots.includes(domain)) return "COMPETITOR" as const

    // Heuristic editorial classification using domain word tokens + URL path signals
    if (isEditorialBySignals(domainOrUrl, domain)) return "EDITORIAL" as const

    return "CORPORATE" as const
}

/**
 * Signal-based editorial detection — NO hardcoded domain list.
 * Works for any domain by reading:
 * 1. Domain word tokens (reuters → "news wire", wsj → "street journal" etc.)
 * 2. URL path segments (/blog/, /news/, /insights/, /best-, /vs-, etc.)
 * 3. Subdomain signals (blog.company.com, news.company.com)
 */
function isEditorialBySignals(domainOrUrl: string, domain: string): boolean {
    // --- 1. Domain-level word signals ---
    // Split domain into word tokens (e.g. "theverge.com" → ["theverge"], "tech-crunch.com" → ["tech", "crunch"])
    const domainRoot = domain.split(".").slice(0, -1).join(".")  // strip TLD
    const domainWords = domainRoot.split(/[-_.]/)

    const editorialDomainWords = [
        // News / media words
        "news", "journal", "gazette", "herald", "tribune", "times", "post", "daily",
        "weekly", "monthly", "press", "media", "wire", "report", "reporter",
        "magazine", "chronicle", "dispatch", "bulletin", "observer", "courier",
        "review", "reviews", "digest",
        // Content marketing / editorial words
        "blog", "insights", "insight", "guide", "guides", "roundup", "editorial",
        "opinion", "analysis", "research", "resources", "academy", "learn",
        "hub", "community", "forum", "knowledge",
    ]

    const hasEditorialDomainWord = domainWords.some(word =>
        word.length >= 3 && editorialDomainWords.includes(word.toLowerCase())
    )
    if (hasEditorialDomainWord) return true

    // --- 2. Subdomain signals (e.g. blog.zapier.com, news.ycombinator.com) ---
    const parts = domain.split(".")
    const subdomain = parts.length >= 3 ? parts[0].toLowerCase() : ""
    if (["blog", "news", "insights", "learn", "resources", "community", "forum"].includes(subdomain)) return true

    // --- 3. URL path signals ---
    let path = ""
    try {
        const urlToParse = domainOrUrl.startsWith("http") ? domainOrUrl : `https://${domainOrUrl}`
        path = new URL(urlToParse).pathname.toLowerCase()
    } catch {
        // Not a full URL, skip path analysis
        return false
    }

    const editorialPathSignals = [
        "/blog/", "/news/", "/insights/", "/articles/", "/article/",
        "/guides/", "/guide/", "/resources/", "/learn/", "/learning/",
        "/editorial/", "/opinion/", "/press/",
        // Comparison / listicle patterns (strong editorial signals)
        "/best-", "/top-", "-vs-", "/vs/", "/compare/", "/alternatives/", "/alternative-",
        "/roundup", "/reviews/", "/review/",
    ]

    return editorialPathSignals.some(signal => path.includes(signal))
}

function isAiEngineDomain(domainOrUrl: string | null | undefined) {
    const domain = normalizeDomain(domainOrUrl)
    return [
        "chatgpt.com",
        "openai.com",
        "gemini.google.com",
        "perplexity.ai",
        "copilot.microsoft.com",
        "bing.com",
    ].includes(domain)
}

type KnownBrand = {
    name: string
    domain: string
    aliases?: string[]
}

const KNOWN_BRANDS: KnownBrand[] = [
    { name: "Peec AI", domain: "peec.ai", aliases: ["PeecAI", "Peec"] },
    { name: "Profound", domain: "profound.ai" },
    { name: "AirOps", domain: "airops.com" },
    { name: "Frase", domain: "frase.io" },
    { name: "Semrush", domain: "semrush.com", aliases: ["Semrush AI Toolkit", "Semrush AI Visibility", "Semrush One"] },
    { name: "Ahrefs", domain: "ahrefs.com" },
    { name: "AthenaHQ", domain: "athenahq.ai", aliases: ["Athena"] },
    { name: "Otterly AI", domain: "otterly.ai", aliases: ["OtterlyAI"] },
    { name: "Scrunch AI", domain: "scrunch.com", aliases: ["ScrunchAI", "Scrunch"] },
    { name: "Writesonic", domain: "writesonic.com" },
    { name: "SE Ranking", domain: "seranking.com", aliases: ["SERanking", "SE Visible"] },
    { name: "Brand24", domain: "brand24.com" },
    { name: "PromptWatch", domain: "promptwatch.com" },
    { name: "PromptPulse", domain: "promptpulse.online", aliases: ["Prompt Pulse"] },
    { name: "Evertune", domain: "evertune.ai" },
    { name: "LLMClicks", domain: "llmclicks.ai", aliases: ["LLM Clicks"] },
    { name: "Pranas", domain: "pranas.co" },
    { name: "OpenForge", domain: "openforge.ai", aliases: ["Open Forge"] },
    { name: "Topify", domain: "topify.ai" },
]

function knownBrandInfo(brandName: string) {
    const key = normalizeBrandKey(brandName)
    return KNOWN_BRANDS.find(brand =>
        normalizeBrandKey(brand.name) === key ||
        (brand.aliases ?? []).some(alias => normalizeBrandKey(alias) === key)
    ) ?? null
}

function knownBrandDomain(brandName: string) {
    return knownBrandInfo(brandName)?.domain ?? null
}

function canonicalBrandName(brandName: string) {
    const trimmed = brandName.trim()
    return knownBrandInfo(trimmed)?.name ?? trimmed
}

function normalizeBrandKey(brandName: string) {
    return normalizeStrictBrandName(brandName)
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

async function embedTextWithRest(text: string): Promise<number[]> {
    const embeddingModelName = process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001'
    const response = await postGeminiRest(
        embeddingModelName,
        'embedContent',
        {
            model: `models/${embeddingModelName}`,
            content: {
                parts: [{ text }]
            }
        }
    )

    const values = response.data?.embedding?.values
    if (!Array.isArray(values)) {
        throw new Error('Gemini REST embedding returned an invalid response.')
    }

    return values
}

async function generateTextWithRest(systemPrompt: string, userPrompt: string): Promise<string> {
    const response = await postGeminiRest(
        'gemini-3.1-flash-lite',
        'generateContent',
        {
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: systemPrompt },
                        { text: userPrompt }
                    ]
                }
            ]
        }
    )

    const text = response.data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('').trim()
    if (!text) {
        throw new Error('Gemini REST generation returned an empty response.')
    }

    return text
}

function chunkForFallbackStream(text: string) {
    const chunks: string[] = []
    const words = text.split(/(\s+)/)
    let buffer = ''

    for (const word of words) {
        buffer += word
        if (buffer.length >= 24) {
            chunks.push(buffer)
            buffer = ''
        }
    }

    if (buffer) chunks.push(buffer)
    return chunks
}

async function postGeminiRest(modelName: string, action: string, payload: Record<string, unknown>) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY is missing.')
    }

    return axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:${action}`,
        payload,
        {
            params: { key: process.env.GEMINI_API_KEY },
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000,
            httpsAgent: shouldAllowInsecureLocalTls()
                ? new https.Agent({ rejectUnauthorized: false })
                : undefined
        }
    )
}

async function analyzeResponseWithGroq(systemPrompt: string, userPrompt: string): Promise<AnalysisResult> {
    if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is missing, and Gemini analysis failed.')
    }

    const response = await postGroqChatCompletion(
        {
            model: GROQ_ANALYSIS_MODEL,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        }
    )

    const raw = response.data?.choices?.[0]?.message?.content
    if (!raw) {
        throw new Error('Groq analysis returned an empty response.')
    }

    return parseJson<AnalysisResult>(raw)
}

async function summarizeBrandResearchWithGroq(systemPrompt: string, userPrompt: string): Promise<BrandResearchResult> {
    const response = await postGroqChatCompletion(
        {
            model: GROQ_ANALYSIS_MODEL,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
        }
    )

    const raw = response.data?.choices?.[0]?.message?.content
    if (!raw) {
        throw new Error('Groq brand research summary returned an empty response.')
    }

    return parseJson<BrandResearchResult>(raw)
}

async function postGroqChatCompletion(payload: Record<string, unknown>) {
    if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is missing.')
    }

    const config = {
        headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json',
        },
        timeout: 60000,
    }

    try {
        return await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            payload,
            config
        )
    } catch (error) {
        if (!isLocalCertificateError(error)) throw error
        return axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
            payload,
        {
                ...config,
                httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        }
    )
    }
}

function isLocalCertificateError(error: unknown): boolean {
    return shouldAllowInsecureLocalTls()
        && typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as { code?: string }).code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
}

function isLocalCertificateOrFetchError(error: unknown): boolean {
    return shouldAllowInsecureLocalTls()
        && error instanceof Error
        && (error.message === 'fetch failed' || isLocalCertificateError(error))
}

function shouldAllowInsecureLocalTls() {
    return process.env.ALLOW_INSECURE_LOCAL_TLS === 'true' || process.env.NODE_ENV !== 'production'
}
