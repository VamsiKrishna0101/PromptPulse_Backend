import type { AnalysisResult } from "../../../prompts/analysis_prompts"
import {
    buildAnalysisSystemPrompt,
    buildAnalysisUserPrompt,
} from "../../../prompts/analysis_prompts"
import { generateWithBedrockGateway } from "../bedrock_gateway_service"
import { parseKimiAnalysisJson } from "./analysis_schema"

type Citation = {
    url?: string | null
    domain?: string | null
    title?: string | null
    text?: string | null
    is_cited?: boolean | null
    source_kind?: string | null
}

export async function analyzeUiAnswerWithKimi(input: {
    uiAnswer: string
    sourceModel: string
    brandName: string
    brandUrl: string
    citations?: Citation[]
}): Promise<AnalysisResult & { ai_model: string }> {
    const uiAnswer = input.uiAnswer.trim()
    if (!uiAnswer) throw new Error("Kimi analysis requires a non-empty UI answer.")

    const raw = await generateWithBedrockGateway(
        buildAnalysisSystemPrompt(),
        buildAnalysisUserPrompt(
            uiAnswer,
            input.brandName,
            input.brandUrl,
            input.citations ?? [],
        ),
        {
            model: process.env.AWS_BEDROCK_ANALYSIS_MODEL
                ?? process.env.AWS_BEDROCK_LLM_MODEL
                ?? "moonshotai.kimi-k2.5",
            temperature: 0,
            maxTokens: Number(process.env.KIMI_ANALYSIS_MAX_OUTPUT_TOKENS ?? 1500),
            responseFormat: "json_object",
        },
    )

    return {
        ...parseKimiAnalysisJson(raw),
        ai_model: input.sourceModel,
    }
}
