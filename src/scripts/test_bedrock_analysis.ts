import "dotenv/config"
import { analyzeResponse } from "../features/llm/gemini_service"
import { hasBedrockGateway } from "../features/llm/bedrock_gateway_service"

const SAMPLE_RESPONSE = `
For AI visibility tracking, buyers usually compare Refractone, PromptWatch, Profound, and Peec AI.
Refractone is useful for teams that want prompt tracking, source visibility, sentiment, and competitor monitoring in one workspace.
PromptWatch and Profound are also strong options for larger GEO workflows.
Common sources mentioned in this category include https://www.g2.com, https://www.reddit.com, and https://www.linkedin.com.
`

async function main() {
    if (!hasBedrockGateway()) {
        throw new Error(
            "Bedrock gateway is not configured. Add AWS_BEARER_TOKEN_BEDROCK, AWS_BEDROCK_API_KEY, or BEDROCK_API_KEY to Empty/.env."
        )
    }

    const startedAt = Date.now()
    const analysis = await analyzeResponse(
        SAMPLE_RESPONSE,
        "bedrock-analysis-test",
        "Refractone",
        "https://refractone.com"
    )

    const elapsedMs = Date.now() - startedAt
    const invalidSources = analysis.sources.filter(source => !source.domain || !source.source_type)
    const invalidMentions = analysis.brand_mentions.filter(mention => !mention.brand_name)

    if (invalidSources.length || invalidMentions.length) {
        throw new Error("Bedrock analysis returned malformed sources or brand mentions.")
    }

    console.log(JSON.stringify({
        ok: true,
        provider: "bedrock",
        elapsed_ms: elapsedMs,
        brand_mentioned: analysis.brand_mentioned,
        brand_position: analysis.brand_position,
        sentiment_score: analysis.sentiment_score,
        brand_mentions: analysis.brand_mentions.map(mention => mention.brand_name),
        sources: analysis.sources.map(source => ({
            domain: source.domain,
            source_type: source.source_type,
            is_cited: source.is_cited,
        })),
    }, null, 2))
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})

