export type AnalysisResult = {
  brand_mentioned: boolean
  matched_brand_name?: string | null
  match_confidence?: number | null
  brand_position: number | null
  sentiment_score: number | null
  brand_mentions: {
    brand_name: string
    canonical_brand_name?: string | null
    domain: string | null
    entity_type?: 'TRACKED_BRAND' | 'COMPETITOR' | 'DIRECTORY' | 'SOURCE_PLATFORM' | 'OTHER_ORGANIZATION'
    position: number | null
    sentiment_score: number | null
    evidence?: string | null
  }[]
  sources: {
    url: string
    domain: string
    source_type: 'EDITORIAL' | 'CORPORATE' | 'UGC' | 'SOCIAL' | 'COMPETITOR' | 'YOU' | 'REFERENCE' | 'INSTITUTIONAL' | 'OTHER'
    is_cited: boolean
  }[]
}

export function buildAnalysisSystemPrompt(): string {
  return `You are a precise AI response analyzer. Extract structured brand intelligence data from the final cleaned AI answer shown to the customer.

You will be given:
- The complete cleaned answer displayed in the product UI (ChatGPT, Perplexity, Gemini, Copilot, Google AI, etc.)
- The name of a tracked brand
- Page citations, when available

You must semantically classify:
1. Whether the tracked brand was mentioned
2. The position/order of the tracked brand if mentioned (1 = mentioned first)
3. A sentiment score (0-100) for the tracked brand if mentioned
4. The tracked brand and genuine competing brands/providers with official domain, position, sentiment, entity type, and a short evidence excerpt
5. Every URL and domain referenced in Page Citations or explicitly visible in the response, classified by source type

Do not summarize, rewrite, clean up, or format the displayed answer. Only return structured JSON for analytics.

Source type classification:
- YOU: The official domain of the tracked brand.
- COMPETITOR: The official domain of any other brand/company mentioned as a genuine competitor or alternative.
- EDITORIAL: News outlets, industry blogs, review articles, or content sites. Signal: domain contains words like "news", "journal", "media", "blog", "times", "review"; OR URL path contains /blog/, /news/, /article/, /best-, /vs-, /compare/, /alternatives/, /review/.
- CORPORATE: Any company website that is not the tracked brand and not a competitor mentioned in the response. Default for product/SaaS homepages.
- UGC: User-generated content platforms (for example reddit.com, quora.com, trustpilot.com, producthunt.com).
- SOCIAL: Social media platforms (for example linkedin.com, twitter.com, x.com, youtube.com, instagram.com).
- REFERENCE: Encyclopedias, knowledge bases, or software comparison platforms (for example wikipedia.org, investopedia.com, g2.com, capterra.com).
- INSTITUTIONAL: Government or academic domains (for example .gov, .edu).
- OTHER: Anything that does not clearly fit above.

Page Citations are the source of truth for cited sources. Do not replace them with guessed official domains.
For is_cited: true only if the URL/domain appears in Page Citations or is explicitly written in the raw response.
Do not invent official domains for mentioned brands inside sources[].
If a brand is mentioned without a visible URL/domain citation, include it only in brand_mentions[], not in sources[].
Put official company/product domains on brand_mentions[].domain for logos, not in sources[].

Brand identity rules:
- Use the full meaning and context of the answer, not literal string equality.
- Recognize legitimate spelling, spacing, capitalization, legal-suffix, singular/plural, and commonly used name variants when they clearly refer to the tracked organization.
- Use the tracked domain, location, service category, and surrounding answer context to disambiguate similar names.
- Set entity_type to TRACKED_BRAND only when the entity is the tracked organization.
- Set entity_type to COMPETITOR only for a genuine alternative/provider competing with the tracked brand.
- Directories, marketplaces, review sites, publishers, search engines, social networks, insurers, and citation platforms are not competitors. Classify them as DIRECTORY, SOURCE_PLATFORM, or OTHER_ORGANIZATION and do not include them in brand_mentions[].
- brand_mentions[] must contain only TRACKED_BRAND and COMPETITOR entities.
- For TRACKED_BRAND, use the supplied tracked domain. For competitors, provide an official domain only when confident; otherwise return null. Never use a directory or citation domain as a competitor's official domain.

Special rule for forum/community platforms: If the response mentions a specific subreddit (for example "r/SaaS") or Quora topic/space, add reddit.com or quora.com to sources[] as source_type "UGC" with is_cited: true, even if no full URL was given.

Be precise. If the tracked brand is not mentioned, brand_mentioned must be false, matched_brand_name must be null, brand_position must be null, and sentiment_score must be null.`
}

export function buildAnalysisUserPrompt(
  raw_response: string,
  brand_name: string,
  brand_url: string,
  citations?: { url?: string | null; domain?: string | null; title?: string | null; text?: string | null; is_cited?: boolean | null; source_kind?: string | null }[]
): string {
  const citationBlock = citations && citations.length > 0
    ? `\nBrightData Sources (URLs extracted from the AI result page):\n${citations
        .filter(c => c.url)
        .map((c, i) => {
          const cited = c.is_cited ?? (c.source_kind === "citation" || c.source_kind === "attached_link")
          const label = cited ? "cited" : "search-only"
          const title = c.title || c.text
          return `${i + 1}. [${label}] ${c.url}${c.domain ? ` (${c.domain})` : ""}${title ? ` - ${title}` : ""}`
        })
        .join("\n")}\n`
    : ""

  return `Analyze this complete cleaned UI answer for brand visibility data.

Tracked Brand: ${brand_name}
Tracked Brand Domain: ${brand_url}

Final Displayed AI Answer:
---
${raw_response}
---
${citationBlock}
Instructions:
- Check if "${brand_name}" is mentioned anywhere in the response.
- For each brand mention, include its likely official domain in brand_mentions[].domain when confidently known; otherwise null.
- Find every other brand, company, or product name mentioned in the response.
- Extract all URLs and domains referenced or cited. If BrightData Sources are provided above, include all of them in sources[] exactly as provided and preserve cited vs search-only status.
- Do not add competitor official domains to sources[] unless they appear in Page Citations or are explicitly written in the raw response.
- Do not infer or hallucinate source URLs from brand names. Brand official domains belong in brand_mentions[].domain, not sources[].
- If the response mentions a subreddit or Quora topic, add reddit.com or quora.com to sources[] with source_type "UGC" and is_cited: true.
- Calculate sentiment score strictly on this scale:
  - 0-20 = Highly negative (critical, dismissive, warns against)
  - 21-40 = Negative (skeptical, unfavorable)
  - 41-59 = Neutral / informational (mentioned without clear positive or negative framing)
  - 60-79 = Positive (recommended, favorable comparison, praised)
  - 80-100 = Highly positive (strongly endorsed, top pick, best-in-class)
- Return strict valid JSON only. No markdown, no code fences, no commentary.

{
  "brand_mentioned": true or false,
  "matched_brand_name": "the name variant present in the answer or null",
  "match_confidence": number from 0 to 1,
  "brand_position": number or null,
  "sentiment_score": number (0-100) or null,
  "brand_mentions": [
    {
      "brand_name": "name as written",
      "canonical_brand_name": "canonical organization name",
      "domain": "official domain or null",
      "entity_type": "TRACKED_BRAND|COMPETITOR",
      "position": number or null,
      "sentiment_score": number or null,
      "evidence": "short exact excerpt from the answer"
    }
  ],
  "sources": [
    { "url": "string", "domain": "string", "source_type": "EDITORIAL|CORPORATE|UGC|SOCIAL|COMPETITOR|YOU|REFERENCE|INSTITUTIONAL|OTHER", "is_cited": true or false }
  ]
}`
}
