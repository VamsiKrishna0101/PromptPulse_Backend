export type AnalysisResult = {
  brand_mentioned: boolean
  brand_position: number | null
  sentiment_score: number | null
  brand_mentions: {
    brand_name: string
    domain: string | null
    position: number | null
    sentiment_score: number | null
  }[]
  sources: {
    url: string
    domain: string
    source_type: 'EDITORIAL' | 'CORPORATE' | 'UGC' | 'SOCIAL' | 'COMPETITOR' | 'YOU' | 'REFERENCE' | 'INSTITUTIONAL' | 'OTHER'
    is_cited: boolean
  }[]
}

export function buildAnalysisSystemPrompt(): string {
  return `You are a precise AI response analyzer. Extract structured brand intelligence data from raw AI assistant responses.

You will be given:
- A raw text response from an AI assistant (ChatGPT, Perplexity, Gemini, Grok, etc.)
- The name of a tracked brand
- Page citations, when available

You must extract:
1. Whether the tracked brand was mentioned
2. The position/order of the tracked brand if mentioned (1 = mentioned first)
3. A sentiment score (0-100) for the tracked brand if mentioned
4. Every brand, company, or product mentioned in the response with official domain, position, and sentiment
5. Every URL and domain referenced in Page Citations or explicitly visible in the response, classified by source type

Do not summarize, rewrite, clean up, or format the raw answer. Only return structured JSON for analytics.

Source type classification:
- YOU: The official domain of the tracked brand.
- COMPETITOR: The official domain of any other brand/company mentioned as a competitor or alternative.
- EDITORIAL: News sites, blogs, review sites, tech journalism (for example techcrunch.com, g2.com, forbes.com).
- CORPORATE: General company websites that are not the tracked brand and not a competitor mentioned in the text.
- UGC: User-generated content platforms (for example reddit.com, quora.com, trustpilot.com).
- SOCIAL: Social media platforms (for example linkedin.com, twitter.com, youtube.com).
- REFERENCE: Encyclopedias, dictionaries, and knowledge bases (for example wikipedia.org, wikidata.org).
- INSTITUTIONAL: Government, academic, or non-profit domains (for example .gov, .edu).
- OTHER: Anything else.

Page Citations are the source of truth for cited sources. Do not replace them with guessed official domains.
For is_cited: true only if the URL/domain appears in Page Citations or is explicitly written in the raw response.
Do not invent official domains for mentioned brands inside sources[].
If a brand is mentioned without a visible URL/domain citation, include it only in brand_mentions[], not in sources[].
Put official company/product domains on brand_mentions[].domain for logos, not in sources[].

Special rule for forum/community platforms: If the response mentions a specific subreddit (for example "r/SaaS") or Quora topic/space, add reddit.com or quora.com to sources[] as source_type "UGC" with is_cited: true, even if no full URL was given.

Be precise. If the tracked brand is not mentioned, brand_mentioned must be false and brand_position must be null.`
}

export function buildAnalysisUserPrompt(
  raw_response: string,
  brand_name: string,
  brand_url: string,
  citations?: { url?: string | null; domain?: string | null; title?: string | null }[]
): string {
  const citationBlock = citations && citations.length > 0
    ? `\nPage Citations (URLs extracted from the page - these are sources the AI used):\n${citations
        .filter(c => c.url)
        .map((c, i) => `${i + 1}. ${c.url}${c.domain ? ` (${c.domain})` : ""}${c.title ? ` - ${c.title}` : ""}`)
        .join("\n")}\n`
    : ""

  return `Analyze this AI response for brand visibility data.

Tracked Brand: ${brand_name}
Tracked Brand Domain: ${brand_url}

Raw AI Response:
---
${raw_response}
---
${citationBlock}
Instructions:
- Check if "${brand_name}" is mentioned anywhere in the response.
- For each brand mention, include its likely official domain in brand_mentions[].domain when confidently known; otherwise null.
- Find every other brand, company, or product name mentioned in the response.
- Extract all URLs and domains referenced or cited. If Page Citations are provided above, include all of them in sources[] exactly as provided.
- Do not add competitor official domains to sources[] unless they appear in Page Citations or are explicitly written in the raw response.
- Do not infer or hallucinate source URLs from brand names. Brand official domains belong in brand_mentions[].domain, not sources[].
- If the response mentions a subreddit or Quora topic, add reddit.com or quora.com to sources[] with source_type "UGC" and is_cited: true.
- Calculate sentiment score strictly on this scale:
  - 50 = Neutral/informational
  - 60-75 = Positive
  - 75-100 = Highly positive
  - 25-40 = Negative
  - 0-25 = Highly negative
- Return strict valid JSON only. No markdown, no code fences, no commentary.

{
  "brand_mentioned": true or false,
  "brand_position": number or null,
  "sentiment_score": number (0-100) or null,
  "brand_mentions": [
    { "brand_name": "string", "domain": "string or null", "position": number or null, "sentiment_score": number or null }
  ],
  "sources": [
    { "url": "string", "domain": "string", "source_type": "EDITORIAL|CORPORATE|UGC|SOCIAL|COMPETITOR|YOU|REFERENCE|INSTITUTIONAL|OTHER", "is_cited": true or false }
  ]
}`
}
