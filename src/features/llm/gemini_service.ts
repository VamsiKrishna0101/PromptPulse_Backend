import { GoogleGenerativeAI } from '@google/generative-ai'
import axios from 'axios'
import https from 'https'
import { buildBrandPromptGenerationSystemPrompt, buildBrandPromptGenerationUserPrompt } from '../../prompts/brand_prompts'
import { buildAnalysisSystemPrompt, buildAnalysisUserPrompt, type AnalysisResult } from '../../prompts/analysis_prompts'
import { buildBrandResearchSystemPrompt, buildBrandResearchUserPrompt, type BrandResearchResult } from '../../prompts/research_prompts'
import { generateWithBedrockGateway, hasBedrockGateway } from './bedrock_gateway_service'

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

    if (hasBedrockGateway()) {
        return parseJson<{ prompts: { topic: string; type: string; text: string }[] }>(
            await generateWithBedrockGateway(systemPrompt, userPrompt, {
                temperature: 0.25,
                maxTokens: 8192,
                responseFormat: "json_object",
            })
        )
    }

    const result = await model.generateContent([
        { text: systemPrompt },
        { text: userPrompt },
    ])

    return parseJson<{ prompts: { topic: string; type: string; text: string }[] }>(result.response.text())
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
    citations?: { url?: string | null; domain?: string | null; title?: string | null }[]
): Promise<AnalysisResult & { ai_model: string }> {
    const systemPrompt = buildAnalysisSystemPrompt()
    const userPrompt = buildAnalysisUserPrompt(raw_response, brand_name, brand_url, citations)

    if (hasBedrockGateway()) {
        const parsed = parseJson<AnalysisResult>(
            await generateWithBedrockGateway(systemPrompt, userPrompt, {
                temperature: 0,
                maxTokens: 8192,
                responseFormat: "json_object",
            })
        )
        return { ...normalizeAnalysisResult(parsed, raw_response, brand_name, brand_url, citations), ai_model }
    }

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

function parseJson<T>(raw: string): T {
    const cleaned = raw
        .trim()
        .replace(/^```json\n?/i, '')
        .replace(/^```\n?/i, '')
        .replace(/\n?```$/i, '')
        .trim()

    return JSON.parse(cleaned) as T
}

function normalizeAnalysisResult(
    analysis: AnalysisResult,
    rawResponse: string,
    brandName: string,
    brandUrl: string,
    citations: { url?: string | null; domain?: string | null; title?: string | null }[] = []
): AnalysisResult {
    const brandMentioned = hasVisibleBrandMention(rawResponse, brandName, brandUrl)
    const citationSources = citations
        .filter(citation => citation.url)
        .map(citation => ({
            url: citation.url!,
            domain: citation.domain || safeDomain(citation.url) || citation.url!,
            source_type: classifySourceDomain(
                citation.domain || safeDomain(citation.url) || citation.url!,
                brandUrl,
                analysis.brand_mentions.map(mention => mention.brand_name)
            ),
            is_cited: true,
        } satisfies AnalysisResult["sources"][number]))

    const explicitDomains = extractExplicitDomains(rawResponse)
    const normalizedSources = dedupeSources([
        ...citationSources,
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
        brand_position: brandMentioned ? analysis.brand_position : null,
        sentiment_score: brandMentioned ? analysis.sentiment_score : null,
        brand_mentions: dedupeBrandMentions(analysis.brand_mentions, citations),
        sources: normalizedSources,
    }
}

function hasVisibleBrandMention(rawResponse: string, brandName: string, brandUrl: string) {
    const lower = rawResponse.toLowerCase()
    const brand = brandName.trim().toLowerCase()
    if (brand && new RegExp(`(^|[^a-z0-9])${escapeRegExp(brand)}([^a-z0-9]|$)`, "i").test(rawResponse)) {
        return true
    }

    const domain = safeDomain(brandUrl)
    return Boolean(domain && lower.includes(domain.toLowerCase()))
}

function dedupeBrandMentions(
    mentions: AnalysisResult["brand_mentions"],
    citations: { url?: string | null; domain?: string | null; title?: string | null }[] = []
) {
    const seen = new Set<string>()
    const normalized: AnalysisResult["brand_mentions"] = []
    for (const mention of mentions) {
        const key = mention.brand_name.trim().toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        normalized.push({
            ...mention,
            domain: normalizeBrandDomain(mention.domain) || domainFromCitations(mention.brand_name, citations) || knownBrandDomain(mention.brand_name),
        })
    }
    return normalized
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
    if (domain && ownDomain && domain === ownDomain) return "YOU" as const
    if (domain.includes("reddit.com") || domain.includes("quora.com") || domain.includes("trustpilot.com")) return "UGC" as const
    if (domain.includes("linkedin.com") || domain.includes("twitter.com") || domain.includes("x.com") || domain.includes("youtube.com")) return "SOCIAL" as const
    if (domain.includes("wikipedia.org") || domain.includes("wikidata.org")) return "REFERENCE" as const
    if (domain.endsWith(".gov") || domain.endsWith(".edu") || domain.includes(".gov.") || domain.includes(".edu.")) return "INSTITUTIONAL" as const
    if (isEditorialDomain(domain)) return "EDITORIAL" as const

    const brandRoots = mentionedBrands
        .map(brand => knownBrandDomain(brand))
        .filter((value): value is string => Boolean(value))
        .map(value => normalizeDomain(value))
    if (brandRoots.includes(domain)) return "COMPETITOR" as const

    return "CORPORATE" as const
}

function isEditorialDomain(domain: string) {
    const editorialMarkers = [
        "blog",
        "insights",
        "review",
        "reviews",
        "roundup",
        "guide",
        "news",
        "forbes.com",
        "techcrunch.com",
        "g2.com",
        "capterra.com",
        "softwareadvice.com",
        "searchengineland.com",
        "digitalapplied.com",
        "therankmasters.com",
        "marketing180.com",
    ]
    return editorialMarkers.some(marker => domain.includes(marker))
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

function knownBrandDomain(brandName: string) {
    const key = brandName.toLowerCase().replace(/[^a-z0-9]/g, "")
    const domains: Record<string, string> = {
        peecai: "peec.ai",
        profound: "profound.ai",
        frase: "frase.io",
        semrush: "semrush.com",
        semrushaitoolkit: "semrush.com",
        semrushaivisibility: "semrush.com",
        semrushone: "semrush.com",
        athenahq: "athenahq.ai",
        athena: "athenahq.ai",
        otterlyai: "otterly.ai",
        scrunchai: "scrunch.com",
        writesonic: "writesonic.com",
        seranking: "seranking.com",
        promptwatch: "promptwatch.com",
        refractone: "refractone.com",
        evertune: "evertune.ai",
        llmclicks: "llmclicks.ai",
        pranas: "pranas.co",
        openforge: "openforge.ai",
        topify: "topify.ai",
    }
    return domains[key] ?? null
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
