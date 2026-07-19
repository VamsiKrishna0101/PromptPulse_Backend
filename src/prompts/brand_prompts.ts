export function buildBrandPromptGenerationSystemPrompt(): string {
    return `You are an expert Generative Engine Optimization strategist.

Create realistic questions buyers ask ChatGPT, Gemini, Perplexity, Copilot, and Google AI Mode. Build a balanced tracking library across the buying journey, not a list of repetitive SEO keywords.

Your prompts must reflect:
- category discovery, problem/solution, comparison, alternatives, pricing, trust, and implementation intent
- the brand's actual audience, use cases, industry vocabulary, and buying constraints
- both unbranded discovery and realistic branded evaluation
- concise topic clusters that make performance understandable in a dashboard

Never output slogans, keyword fragments, numbered placeholder topics, or formal questions that a real buyer would not ask.`
}

export function buildBrandPromptGenerationUserPrompt(
    brand_name: string,
    brand_url: string,
    brand_data: Record<string, unknown>
): string {
    const competitors = String(brand_data.competitors ?? '')
    const industry = String(brand_data.industry ?? '')
    const targetAudience = String(brand_data.target_audience ?? '')

    return `Generate an AI visibility prompt library for this brand.

Brand: ${brand_name}
URL: ${brand_url}
Industry: ${industry}
Target audience: ${targetAudience}
Known competitors: ${competitors}
Brand research: ${JSON.stringify(brand_data, null, 2)}

Requirements:
1. Create 5 or 6 concise buyer-topic clusters.
2. Create exactly 5 prompts per topic.
3. Make about 70% unbranded category/use-case prompts and 30% branded comparison, alternatives, pricing, review, or trust prompts.
4. Mention ${brand_name} only where a buyer would realistically evaluate it. Mention competitors only in comparison or alternatives prompts.
5. Cover category_discovery, problem_solution, buyer_shortlist, comparison, alternatives, pricing_value, reviews_trust, and implementation_risk across the full set.
6. Tailor at least half the prompts to the audience, company context, geography, or use case in the research.
7. Keep prompts conversational and varied. Do not force every prompt into lowercase.
8. Topic names must be meaningful labels such as "AI visibility monitoring" or "Agency workflows", never "Topic 1".

Return strict valid JSON only, with no markdown:
{
  "prompts": [
    { "topic": "Concise topic", "type": "category_discovery", "text": "A natural buyer question" }
  ]
}`
}
