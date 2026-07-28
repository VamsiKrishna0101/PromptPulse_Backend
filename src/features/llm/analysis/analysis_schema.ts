import { z } from "zod"
import type { AnalysisResult } from "../../../prompts/analysis_prompts"

const nullableDomain = z.string().trim().min(1).nullable().catch(null)
const nullablePosition = z.number().int().positive().nullable().catch(null)
const nullableSentiment = z.number().min(0).max(100).nullable().catch(null)

const brandMentionSchema = z.object({
    brand_name: z.string().trim().min(1),
    canonical_brand_name: z.string().trim().min(1).nullable().optional(),
    domain: nullableDomain,
    entity_type: z.enum([
        "TRACKED_BRAND",
        "COMPETITOR",
        "DIRECTORY",
        "SOURCE_PLATFORM",
        "OTHER_ORGANIZATION",
    ]),
    position: nullablePosition,
    sentiment_score: nullableSentiment,
    evidence: z.string().trim().max(500).nullable().optional(),
})

const sourceSchema = z.object({
    url: z.string().trim().catch(""),
    domain: z.string().trim().catch(""),
    source_type: z.enum([
        "EDITORIAL",
        "CORPORATE",
        "UGC",
        "SOCIAL",
        "COMPETITOR",
        "YOU",
        "REFERENCE",
        "INSTITUTIONAL",
        "OTHER",
    ]).catch("OTHER"),
    is_cited: z.boolean().catch(false),
})

const kimiAnalysisSchema = z.object({
    brand_mentioned: z.boolean(),
    matched_brand_name: z.string().trim().min(1).nullable().optional(),
    match_confidence: z.number().min(0).max(1).nullable().optional(),
    brand_position: nullablePosition,
    sentiment_score: nullableSentiment,
    brand_mentions: z.array(brandMentionSchema).default([]),
    sources: z.array(sourceSchema).default([]),
})

export type KimiAnalysisResult = z.infer<typeof kimiAnalysisSchema>

export function parseKimiAnalysisJson(raw: string): AnalysisResult {
    const cleaned = raw
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim()

    const parsed = kimiAnalysisSchema.parse(JSON.parse(cleaned))
    return parsed as AnalysisResult
}
