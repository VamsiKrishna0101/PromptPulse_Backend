export type BrandResearchResult = {
  tagline: string | null
  description: string
  industry: string
  founded: string | null
  headquarters: string | null
  employee_count: string | null
  business_model: string
  target_audience: string
  key_products_services: string
  pricing_model: string | null
  competitors: string
  recent_news_or_updates: string | null
  social_presence: string | null
  tone_and_brand_voice: string
  unique_value_proposition: string
}

export function buildBrandResearchSystemPrompt(): string {
  return `You are a precise brand research analyst for an AI visibility platform.

You receive crawled public website data from a brand's own website. Use only the provided crawl data. If a field is not available, return null for nullable fields or a careful best-effort phrase for required fields.

Return strict valid JSON only. No markdown, no code fences, no commentary.`
}

export function buildBrandResearchUserPrompt(
  brand_name: string,
  brand_url: string,
  crawl_data: Record<string, unknown>
): string {
  return `Create structured brand research from this public website crawl.

Brand Name: ${brand_name}
Brand URL: ${brand_url}

Crawl Data:
${JSON.stringify(crawl_data, null, 2)}

Return this exact JSON shape:
{
  "tagline": "string or null",
  "description": "2-4 sentence summary of what the brand does",
  "industry": "primary industry",
  "founded": "string or null",
  "headquarters": "string or null",
  "employee_count": "string or null",
  "business_model": "how the brand makes money",
  "target_audience": "who the brand sells to",
  "key_products_services": "main products or services",
  "pricing_model": "string or null",
  "competitors": "3-5 likely competitors if inferable, comma-separated",
  "recent_news_or_updates": "string or null",
  "social_presence": "social links or presence if found, string or null",
  "tone_and_brand_voice": "brand tone",
  "unique_value_proposition": "what makes the brand different"
}`
}
