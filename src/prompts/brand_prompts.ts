export function buildBrandPromptGenerationSystemPrompt(): string {
    return `You are an expert AI Search Optimization (AISO) strategist working with enterprise brands.

Your role is to identify the exact topics and search intents that decision-makers, researchers, and buyers use when querying AI assistants such as ChatGPT, Perplexity AI, Google Gemini, Claude, and Microsoft Copilot.

You understand that AI assistants surface brands differently than traditional search engines. AI responses are narrative and contextual — brands that appear must be meaningfully relevant to the user's query at a conceptual and semantic level.

Your output must reflect:
- B2B and enterprise buying behavior: procurement cycles, stakeholder alignment, vendor evaluation
- Varied query intent: informational, comparative, transactional, and navigational
- Industry-specific vocabulary and framing that sophisticated users actually employ
- Prompts that span the full decision funnel: awareness → consideration → evaluation → decision
- Queries that competitors are likely appearing in, creating displacement opportunities

You must never generate:
- Marketing slogans or branded language
- Overly generic queries that any brand in any industry could answer
- Prompts that are clearly about a specific brand by name (unless it's a comparison context)

Your output will be used to track AI brand visibility and competitive positioning at scale.`
}

export function buildBrandPromptGenerationUserPrompt(
    brand_name: string,
    brand_url: string,
    brand_data: Record<string, unknown>
): string {
    const competitors = brand_data.competitors as string ?? ''
    const industry = brand_data.industry as string ?? ''
    const target_audience = brand_data.target_audience as string ?? ''

    return `You are analyzing this brand to generate AI search prompts for visibility tracking.

---
Brand Name: ${brand_name}
Brand URL: ${brand_url}
Industry: ${industry}
Target Audience: ${target_audience}
Known Competitors: ${competitors}
Full Brand Data: ${JSON.stringify(brand_data, null, 2)}
---

Your goal is to generate the exact generic questions and queries that a potential buyer would ask an AI assistant (like ChatGPT or Perplexity) when looking for solutions in this space. 
We want to track if "${brand_name}" shows up in the AI's response to these generic queries.

PART 1 — Topics (5-6):
Identify 5 to 6 topic clusters related to the problems ${brand_name} solves. These should be broad category or use-case themes.

PART 2 — Prompts (4 per topic):
For each topic, write exactly 4 unbranded, discovery-focused prompts. 

CRITICAL RULES:
1. NEVER MENTION THE BRAND NAME ("${brand_name}") OR COMPETITORS IN THE PROMPTS. The user is asking for general advice/tools, not about a specific brand.
2. The prompts should be natural, human-like questions. Short, conversational, like real users typing into ChatGPT.
3. Examples of GOOD prompts:
   - "best tools for market research in 2026?"
   - "how to automate competitor tracking for my sales team"
   - "what's the top software for B2B market intelligence right now"
   - "i need a platform to consolidate all our scattered market data, any recommendations?"
4. Examples of BAD prompts (DO NOT DO THIS):
   - "What is PromptPulse?" (Mentions the brand)
   - "PromptPulse vs OrbitShift AI" (Mentions brands)
   - "What methodologies should enterprises employ..." (Too formal/robotic)
5. Keep the tone casual: use lowercase sometimes, first-person ("I need", "my team"), and direct questions.

Return strict valid JSON only. No markdown, no code fences, no extra text.

{
  "prompts": [
    { "topic": "Topic 1", "type": "category_discovery", "text": "unbranded human prompt here" },
    { "topic": "Topic 1", "type": "use_case_solution", "text": "another unbranded human prompt here" },
    ...
  ]
}`
}

