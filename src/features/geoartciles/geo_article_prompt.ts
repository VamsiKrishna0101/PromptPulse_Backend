import type { GeoArticleBrief } from "./geoarticle_types"

export function buildGeoArticleSystemPrompt() {
    return [
        "You are a GEO (Generative Engine Optimization) content specialist. Your output will be used inside an AI-visibility SaaS to help B2B brands appear more often in ChatGPT, Gemini, and Perplexity answers.",
        "",
        "LLM CITATION RULES — your article must satisfy these or it will not be cited by AI engines:",
        "1. Answer the target query directly in the FIRST sentence. No preamble.",
        "2. Use H2 headings phrased as natural buyer questions (e.g. 'How does X compare with Y?').",
        "3. Every factual claim needs a specific subject, verb, and number. No vague generalities.",
        "4. Include a 3-6 row comparison table if competitor evidence is provided.",
        "5. Include a 4-6 item FAQ block. Each answer must be 1-3 sentences, direct, and self-contained.",
        "6. Use bullet lists for any group of 3+ related items — LLMs heavily cite structured lists.",
        "7. Include exactly ONE clear call-to-action at the end.",
        "",
        "CONTENT RULES:",
        "- Use only the supplied DB evidence. Never invent stats, case studies, quotes, or customer names.",
        "- If data is genuinely missing, write [NEEDS DATA: describe what is needed] inline.",
        "- Write for a B2B buyer who is 60% through their decision process.",
        "- Forbidden words: unlock, leverage, game-changing, revolutionary, in today's landscape, cutting-edge, robust, seamlessly.",
        "- Tone: direct, specific, credible. No adjective inflation.",
        "",
        "RETURN: strict JSON only. No markdown wrapper. No explanation outside the JSON."
    ].join("\n")
}

export function buildGeoArticleUserPrompt(brief: GeoArticleBrief) {
    const competitorNames = brief.competitors.map(c => c.name).join(", ") || "none tracked"
    const topSources = brief.sources_to_reference.slice(0, 5).map(s => s.domain).join(", ") || "none"
    const geoContext = brief.geo_country ? `\nGEO TARGET: This article is specifically optimized for users in ${brief.geo_country}. Localize examples, regulations, and terminology where relevant.` : ""

    const schema = {
        title: "string — phrased as a real search/AI query, max 80 chars",
        meta_description: "string — 150-160 chars, answer-first",
        slug: "string — kebab-case, max 80 chars",
        target_query: "string — the exact buyer question this page answers",
        search_intent: "one of: informational | commercial | navigational | transactional",
        article_markdown: "string — full article in GitHub-flavored Markdown. Must include: H1 (article title), H2 buyer-question sections, one comparison table if competitors exist, bullet lists, FAQ section, CTA at end.",
        faq: [
            { question: "string — phrased as a natural question", answer: "string — 1-3 sentences, direct, self-contained" }
        ],
        json_ld: "string — JSON-LD Article schema stringified. Include name, description, url (use suggested_slug), dateModified (today).",
        needs_data: ["string — each item describes a specific data point missing from the brief that would strengthen this article"]
    }

    return [
        `Create a GEO-optimized article from the DB brief below.${geoContext}`,
        "",
        "Return JSON matching this exact schema (no extra keys, no markdown wrapper):",
        JSON.stringify(schema, null, 2),
        "",
        "=== DB BRIEF ===",
        "",
        `Brand: ${brief.brand.name} (${brief.brand.url})`,
        `Topic: ${brief.topic}`,
        `Target query: "${brief.target_prompt.text}"`,
        `Content action: ${brief.recommended_article.action} (${brief.recommended_article.content_type})`,
        `Article title: ${brief.recommended_article.title}`,
        `Suggested slug: /${brief.recommended_article.suggested_slug}`,
        `Target intent: ${brief.recommended_article.target_intent}`,
        `Priority reason: ${brief.recommended_article.priority_reason}`,
        "",
        "=== BRAND METRICS (own visibility in DB) ===",
        `Visibility: ${brief.metrics.own_visibility}%`,
        `Avg position when mentioned: ${brief.metrics.own_avg_position ?? "not tracked"}`,
        `Avg sentiment: ${brief.metrics.own_avg_sentiment ?? "not tracked"}`,
        `Evidence count: ${brief.metrics.evidence_count} AI answers from last ${brief.metrics.days_analyzed} days`,
        "",
        "=== COMPETITORS APPEARING IN AI ANSWERS ===",
        brief.competitors.length
            ? brief.competitors.map(c =>
                `- ${c.name}: ${c.visibility}% visible, avg position ${c.avg_position ?? "n/a"}, sentiment ${c.avg_sentiment ?? "n/a"}`
            ).join("\n")
            : "No competitor evidence yet.",
        "",
        "=== SOURCES AI ENGINES CITE FOR THIS TOPIC ===",
        brief.sources_to_reference.length
            ? brief.sources_to_reference.slice(0, 6).map(s =>
                `- ${s.domain} (cited ${s.mentions}x)${s.title ? ` — "${s.title}"` : ""}`
            ).join("\n")
            : "No source evidence yet.",
        "",
        "=== ANSWER PATTERNS FROM REAL AI RESPONSES ===",
        brief.answer_patterns.length
            ? brief.answer_patterns.map(p => `- ${p}`).join("\n")
            : "No patterns extracted yet.",
        "",
        "=== ARTICLE OUTLINE (sections to cover) ===",
        brief.outline.map((item, i) => `${i + 1}. ${item}`).join("\n"),
        "",
        "=== MISSING ANGLES (must address) ===",
        brief.missing_angles.map(a => `- ${a}`).join("\n"),
        "",
        "=== FAQ SEEDS (expand each into question + answer) ===",
        brief.faqs.map(q => `- ${q}`).join("\n"),
        "",
        `Key competitors to mention: ${competitorNames}`,
        `Key sources to reference: ${topSources}`,
    ].join("\n")
}
