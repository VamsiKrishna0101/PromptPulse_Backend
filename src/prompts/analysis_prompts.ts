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
  return `You are a precise AI response analyzer. Your job is to extract structured brand intelligence data from raw AI assistant responses.

You will be given:
- A raw text response from an AI assistant (ChatGPT, Perplexity, Gemini, Grok, etc.)
- The name of a tracked brand
- A list of competitor brands to also detect

You must extract:
1. Whether the tracked brand was mentioned
2. The position (rank/order) of the tracked brand if mentioned (1 = mentioned first)
3. A sentiment score (0-100) for the tracked brand if mentioned — based on the language and context around the mention
4. Every brand mentioned in the response with their official domain, position, and sentiment
5. Every URL and domain referenced in the response, classified by source type

Source type classification:
- YOU: The official domain of the tracked brand (the brand you are analyzing for).
- COMPETITOR: The official domain of any other brand/company mentioned in the response as a competitor or alternative.
- EDITORIAL: News sites, blogs, review sites, tech journalism (e.g. techcrunch.com, g2.com, forbes.com).
- CORPORATE: General company websites that are NOT the tracked brand and NOT a competitor mentioned in the text.
- UGC: User-generated content platforms (e.g. reddit.com, quora.com, trustpilot.com).
- SOCIAL: Social media platforms (e.g. linkedin.com, twitter.com, youtube.com).
- REFERENCE: Encyclopedias, dictionaries, and knowledge bases (e.g. wikipedia.org, wikidata.org).
- INSTITUTIONAL: Government, academic, or non-profit domains (e.g. .gov, .edu).
- OTHER: Anything else.

For is_cited: true only if the URL/domain appears in Page Citations or is explicitly written in the raw response.
Do not invent official domains for mentioned brands inside sources[].
If a brand is mentioned without a visible URL/domain citation, include it only in brand_mentions[], not in sources[].
Put official company/product domains on brand_mentions[].domain for logos, not in sources[].

Be precise. If the brand is not mentioned, brand_mentioned must be false and brand_position must be null.`
}

export function buildAnalysisUserPrompt(
  raw_response: string,
  brand_name: string,
  brand_url: string,
  citations?: { url?: string | null; domain?: string | null; title?: string | null }[]
): string {
  const citationBlock = citations && citations.length > 0
    ? `\nPage Citations (URLs extracted from the page — these are sources the AI used):\n${citations
        .filter(c => c.url)
        .map((c, i) => `${i + 1}. ${c.url}${c.domain ? ` (${c.domain})` : ""}${c.title ? ` — ${c.title}` : ""}`)
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
- Check if "${brand_name}" is mentioned anywhere in the response
- For each brand mention, include its likely official domain in brand_mentions[].domain when confidently known; otherwise null
- Find EVERY other brand, company, or product name mentioned in the response — these are all competitors
- Extract all URLs and domains referenced or cited. If Page Citations are provided above, include ALL of them in sources[]
- Do NOT add competitor official domains to sources[] unless they appear in Page Citations or are explicitly written in the raw response
- Brand/company domains needed for logos are not source citations and should not be included here
- Calculate sentiment score strictly on this scale: 
    - 50 = Neutral/Informational (just stating facts, features, or listing the brand)
    - 60-75 = Positive (useful, popular, good for X)
    - 75-100 = Highly Positive (excellent, best in class, highly recommended)
    - 25-40 = Negative (lacking features, expensive, issues)
    - 0-25 = Highly Negative (avoid, terrible, major flaws)
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
