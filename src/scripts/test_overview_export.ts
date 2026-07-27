import { mkdir, writeFile } from "node:fs/promises"
import { buildOverviewPdf } from "../features/exports/overview/overview_export_pdf"
import { buildOverviewExcel } from "../features/exports/overview/overview_export_excel"
import type { OverviewExportModel } from "../features/exports/overview/overview_export_types"

const outputDir = "tmp/pdfs/overview-export-qa"
const generatedAt = new Date("2026-07-26T12:00:00Z")
const engineNames = ["ChatGPT", "Gemini", "Perplexity", "Copilot"]
const prompts = [
    "Which AI visibility platforms are best for growing brands?",
    "What are the strongest alternatives to Semrush for AI search tracking?",
    "Which tools monitor brand mentions across ChatGPT and Gemini?",
    "How can a marketing team improve visibility in AI-generated answers?",
    "What platform compares brand visibility against competitors?",
    "Which AI search analytics tools include source intelligence?",
    "How do agencies report AI visibility to enterprise clients?",
    "What is the best GEO platform for multi-brand teams?",
    "Which tools identify citation and content gaps in AI answers?",
    "How can brands measure sentiment across AI search engines?",
    "What software tracks prompts across multiple markets?",
    "Which AI visibility platform supports evidence-level reporting?",
]

const model: OverviewExportModel = {
    brandName: "Vikas Hospitals",
    brandUrl: "https://vikashospitals.com",
    generatedAt,
    filters: { days: 30 },
    periodLabel: "Last 30 days",
    comparisonLabel: "Previous 30 days",
    metrics: [
        { label: "AI responses", value: 540, previous: 485, delta: 55, description: "Successful analyzed responses", format: "number" },
        { label: "Brand visibility", value: 71.9, previous: 66.4, delta: 5.5, description: "Responses mentioning the brand", format: "percent" },
        { label: "Average position", value: 3.1, previous: 3.8, delta: -0.7, description: "Rank when the brand appears", format: "position", lowerIsBetter: true },
        { label: "Sentiment score", value: 78.2, previous: 74.5, delta: 3.7, description: "Average measured brand sentiment", format: "score" },
        { label: "Source domains", value: 326, previous: 281, delta: 45, description: "Distinct domains in answers", format: "number" },
    ],
    trend: Array.from({ length: 20 }, (_, index) => ({
        date: `2026-07-${String(index + 1).padStart(2, "0")}`,
        visibility: 57 + index * 0.75 + Math.sin(index) * 6,
        responses: 27,
    })),
    engines: engineNames.map((engine, index) => ({
        engine,
        responses: 135,
        visibility: 78 - index * 6.5,
        position: 2.6 + index * 0.8,
        sentiment: 81 - index * 2.4,
        sourceDomains: 92 - index * 11,
    })),
    prompts: prompts.map((prompt, index) => ({
        promptId: `prompt-${index}`,
        prompt,
        topic: index % 2 ? "Competitor research" : "AI visibility",
        responses: 20,
        visibility: 18 + index * 7,
        position: 7.2 - index * 0.4,
        sentiment: 61 + index * 1.8,
        status: index < 3 ? "GAP" : index < 8 ? "OPPORTUNITY" : "LEADER",
    })),
    topics: [
        { topic: "AI visibility", prompts: 6, responses: 270, visibility: 74.1, position: 2.9 },
        { topic: "Competitor research", prompts: 6, responses: 270, visibility: 69.7, position: 3.4 },
    ],
    brands: [
        ["Vikas Hospitals", 71.9, 388, 3.1, 78.2, true],
        ["Apollo Hospitals", 62.2, 336, 4.8, 72.4, false],
        ["Aster Hospitals", 57.8, 312, 5.2, 69.8, false],
        ["Manipal Hospitals", 53.0, 286, 5.9, 70.5, false],
        ["KIMS Hospitals", 44.6, 241, 6.4, 67.2, false],
        ["CARE Hospitals", 36.1, 195, 7.1, 65.8, false],
    ].map((row, index) => ({
        rank: index + 1,
        brand: row[0] as string,
        visibility: row[1] as number,
        mentions: row[2] as number,
        position: row[3] as number,
        sentiment: row[4] as number,
        isOwnBrand: row[5] as boolean,
    })),
    sources: Array.from({ length: 26 }, (_, index) => ({
        rank: index + 1,
        domain: ["practo.com", "justdial.com", "timesofindia.com", "vikashospitals.com", "reddit.com"][index % 5],
        title: `Authoritative healthcare source article ${index + 1}`,
        usedPct: 29 - index * 0.7,
        sourceType: index % 3 ? "EDITORIAL" : "CORPORATE",
        citations: 42 - index,
        url: `https://example.com/source-${index + 1}`,
        brandPresence: index % 4 === 0 ? "CONFIRMED" : "NOT_CONFIRMED",
    })),
    sourceTypes: [
        { sourceType: "EDITORIAL", domains: 12, citations: 188, confirmedDomains: 4 },
        { sourceType: "CORPORATE", domains: 8, citations: 121, confirmedDomains: 2 },
        { sourceType: "UGC", domains: 4, citations: 73, confirmedDomains: 1 },
        { sourceType: "SOCIAL", domains: 2, citations: 35, confirmedDomains: 0 },
    ],
    sentiment: { scoredResponses: 388, positive: 292, neutral: 78, negative: 18, average: 78.2 },
    opportunities: Array.from({ length: 7 }, (_, index) => ({
        title: `Improve coverage for high-intent healthcare query ${index + 1}`,
        prompt: prompts[index],
        competitor: "Apollo Hospitals",
        impact: index < 3 ? "HIGH" : "MEDIUM",
        effort: index % 2 ? "LOW" : "MEDIUM",
        score: 91 - index * 5,
        nextStep: "Create or refresh a focused service page with physician proof, location relevance, FAQs, and structured evidence.",
    })),
    actions: Array.from({ length: 6 }, (_, index) => ({
        priority: index < 2 ? "HIGH" as const : "MEDIUM" as const,
        horizon: index < 2 ? "NOW" as const : index < 4 ? "NEXT" as const : "LATER" as const,
        title: `Strengthen high-intent healthcare visibility priority ${index + 1}`,
        rationale: `Measured prompt, engine, competitor, and source evidence indicates priority ${index + 1}.`,
        action: "Create or strengthen an evidence-rich service page, then earn authoritative third-party mentions and monitor movement.",
        evidence: `${91 - index * 5} opportunity score with a measured competitor and source gap.`,
    })),
    evidence: Array.from({ length: 24 }, (_, index) => ({
        date: new Date(`2026-07-${String(24 - Math.floor(index / 4)).padStart(2, "0")}T12:00:00Z`),
        engine: engineNames[index % 4],
        prompt: prompts[index % prompts.length],
        mentioned: index % 3 !== 0,
        position: index % 3 !== 0 ? 1 + (index % 7) : null,
        sentiment: index % 3 !== 0 ? 68 + (index % 18) : null,
        source: ["practo.com", "justdial.com", "timesofindia.com"][index % 3],
    })),
    coverage: {
        activePrompts: 50,
        representedPrompts: 12,
        responses: 540,
        successfulRuns: 27,
        partialRuns: 2,
        failedRuns: 1,
        completedJobs: 540,
        failedJobs: 8,
        firstResponseAt: new Date("2026-06-27T12:00:00Z"),
        lastResponseAt: new Date("2026-07-26T12:00:00Z"),
    },
    executiveHeadline: "Vikas Hospitals is visible in 71.9% of analyzed AI responses at an average position of #3.1.",
    executivePoints: [
        "Visibility improved by 5.5 points versus the previous period.",
        "ChatGPT is the strongest measured engine at 78.0% visibility.",
        "Three tracked prompts currently sit in the visibility gap tier.",
        "Apollo Hospitals is the strongest measured competitor in this response set.",
        "Seven evidence-backed opportunities are ready for prioritization.",
    ],
    methodology: [
        "Visibility is the share of successfully analyzed AI responses that mention the tracked brand.",
        "Average position is calculated only for responses where the tracked brand is present; lower is better.",
        "Brand names are normalized case-insensitively before aggregation to prevent duplicate leaderboard entries.",
        "Engine, prompt, competitor, sentiment, and source metrics reuse stored response evidence; this export makes no new provider or LLM calls.",
        "Confirmed source brand presence is shown only when structured source metadata explicitly contains the tracked brand.",
        "Previous-period changes use the immediately preceding reporting window.",
        "Results reflect successful stored responses and active report filters.",
    ],
}

await mkdir(outputDir, { recursive: true })
await writeFile(`${outputDir}/overview-enterprise.pdf`, await buildOverviewPdf(model))
await writeFile(`${outputDir}/overview-enterprise.xlsx`, await buildOverviewExcel(model))
await writeFile(`${outputDir}/overview-enterprise.json`, JSON.stringify(model, null, 2))
console.log(outputDir)
