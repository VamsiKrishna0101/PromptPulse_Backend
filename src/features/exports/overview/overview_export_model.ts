import type {
    OverviewActionRow,
    OverviewEngineRow,
    OverviewExportModel,
    OverviewMetric,
    OverviewPromptRow,
} from "./overview_export_types"

export function round(value: number, digits = 2) {
    const factor = 10 ** digits
    return Math.round(value * factor) / factor
}

export function buildActionPlan(input: {
    brandName: string
    engines: OverviewEngineRow[]
    prompts: OverviewPromptRow[]
    sources: Array<{ domain: string; usedPct: number; brandPresence: "CONFIRMED" | "NOT_CONFIRMED" }>
    competitors: Array<{ brand: string; visibility: number; isOwnBrand: boolean }>
    opportunities: Array<{ title: string; nextStep: string; score: number; prompt: string }>
}): OverviewActionRow[] {
    const actions: OverviewActionRow[] = []
    const weakestPrompt = [...input.prompts].sort((a, b) => a.visibility - b.visibility)[0]
    const weakestEngine = [...input.engines].sort((a, b) => a.visibility - b.visibility)[0]
    const topUnconfirmed = input.sources.find(source => source.brandPresence === "NOT_CONFIRMED")
    const own = input.competitors.find(brand => brand.isOwnBrand)
    const topCompetitor = input.competitors.find(brand => !brand.isOwnBrand)

    for (const opportunity of input.opportunities.slice(0, 2)) {
        actions.push({
            priority: opportunity.score >= 70 ? "HIGH" : "MEDIUM",
            horizon: actions.length ? "NEXT" : "NOW",
            title: opportunity.title,
            rationale: opportunity.prompt,
            action: opportunity.nextStep,
            evidence: `Evidence-backed opportunity score ${Math.round(opportunity.score)}.`,
        })
    }

    if (weakestPrompt) {
        actions.push({
            priority: weakestPrompt.visibility < 35 ? "HIGH" : "MEDIUM",
            horizon: "NOW",
            title: `Improve coverage for “${weakestPrompt.prompt}”`,
            rationale: `This prompt has ${weakestPrompt.visibility.toFixed(1)}% visibility across ${weakestPrompt.responses} measured responses.`,
            action: "Create or strengthen the page that directly answers this buyer question, then reinforce it with proof, comparisons, FAQs, and structured data.",
            evidence: `Average position ${weakestPrompt.position === null ? "not established" : `#${weakestPrompt.position.toFixed(1)}`}; topic ${weakestPrompt.topic || "Uncategorized"}.`,
        })
    }

    if (weakestEngine) {
        actions.push({
            priority: weakestEngine.visibility < 35 ? "HIGH" : "MEDIUM",
            horizon: "NEXT",
            title: `Close the ${weakestEngine.engine} visibility gap`,
            rationale: `${weakestEngine.engine} is the weakest measured engine at ${weakestEngine.visibility.toFixed(1)}% visibility.`,
            action: "Review the sources and answer patterns used by this engine, then target the most repeated third-party domains and missing answer themes.",
            evidence: `${weakestEngine.responses} responses and ${weakestEngine.sourceDomains} distinct source domains measured.`,
        })
    }

    if (topUnconfirmed) {
        actions.push({
            priority: "MEDIUM",
            horizon: "NEXT",
            title: `Build verified presence on ${topUnconfirmed.domain}`,
            rationale: `The domain appears in ${topUnconfirmed.usedPct.toFixed(1)}% of measured responses, but structured source evidence does not confirm the tracked brand.`,
            action: "Pursue an editorial mention, profile, comparison inclusion, review, or evidence-led contribution appropriate to the domain.",
            evidence: "Source priority is based on measured citation frequency, not inferred brand presence.",
        })
    }

    if (own && topCompetitor) {
        actions.push({
            priority: topCompetitor.visibility >= own.visibility ? "HIGH" : "MEDIUM",
            horizon: "LATER",
            title: `Defend the lead against ${topCompetitor.brand}`,
            rationale: `${input.brandName} is at ${own.visibility.toFixed(1)}% visibility versus ${topCompetitor.brand} at ${topCompetitor.visibility.toFixed(1)}%.`,
            action: "Track the prompts and sources where the competitor appears without the brand, then turn the highest-value gaps into content and authority campaigns.",
            evidence: `${Math.abs(own.visibility - topCompetitor.visibility).toFixed(1)} percentage-point visibility difference.`,
        })
    }

    const unique = new Map(actions.map(action => [action.title, action]))
    return [...unique.values()].slice(0, 6)
}

export function average(values: Array<number | null | undefined>) {
    const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    return usable.length ? round(usable.reduce((sum, value) => sum + value, 0) / usable.length) : null
}

export function percent(part: number, total: number) {
    return total > 0 ? round((part / total) * 100) : 0
}

export function canonicalBrandKey(value: string) {
    return value.trim().toLocaleLowerCase().replace(/\s+/g, " ")
}

export function displayEngine(value: string) {
    const normalized = value.trim().toLowerCase()
    if (normalized.includes("chatgpt") || normalized.includes("openai")) return "ChatGPT"
    if (normalized.includes("gemini") || normalized.includes("google")) return "Gemini"
    if (normalized.includes("perplexity")) return "Perplexity"
    if (normalized.includes("copilot") || normalized.includes("bing")) return "Copilot"
    return value.trim() || "Unknown"
}

export function promptStatus(visibility: number): OverviewPromptRow["status"] {
    if (visibility >= 70) return "LEADER"
    if (visibility >= 35) return "OPPORTUNITY"
    return "GAP"
}

export function metric(input: Omit<OverviewMetric, "delta">): OverviewMetric {
    const rawDelta = input.previous === null ? null : input.value - input.previous
    return { ...input, delta: rawDelta === null ? null : round(rawDelta) }
}

export function buildExecutiveNarrative(input: {
    brandName: string
    metrics: OverviewMetric[]
    engines: OverviewEngineRow[]
    prompts: OverviewPromptRow[]
    competitorName: string | null
    opportunities: number
}): Pick<OverviewExportModel, "executiveHeadline" | "executivePoints"> {
    const visibility = input.metrics.find(item => item.label === "Brand visibility")
    const position = input.metrics.find(item => item.label === "Average position")
    const bestEngine = [...input.engines].sort((a, b) => b.visibility - a.visibility)[0]
    const gaps = input.prompts.filter(prompt => prompt.status === "GAP").length
    const movement = visibility?.delta ?? null
    const direction = movement === null
        ? "No previous-period comparison is available."
        : movement >= 0
            ? `Visibility improved by ${Math.abs(movement).toFixed(1)} points versus the previous period.`
            : `Visibility declined by ${Math.abs(movement).toFixed(1)} points versus the previous period.`

    return {
        executiveHeadline: `${input.brandName} is visible in ${(visibility?.value ?? 0).toFixed(1)}% of analyzed AI responses${position ? ` at an average position of #${position.value.toFixed(1)}` : ""}.`,
        executivePoints: [
            direction,
            bestEngine
                ? `${bestEngine.engine} is the strongest measured engine at ${bestEngine.visibility.toFixed(1)}% visibility.`
                : "No engine-level response data is available for this period.",
            gaps
                ? `${gaps} tracked prompt${gaps === 1 ? "" : "s"} currently sit in the visibility gap tier.`
                : "No tracked prompts fall into the visibility gap tier.",
            input.competitorName
                ? `${input.competitorName} is the strongest measured competitor in this response set.`
                : "No competitor has enough measured evidence for comparison.",
            input.opportunities
                ? `${input.opportunities} evidence-backed opportunities are ready for prioritization.`
                : "Continue collecting responses before prioritizing opportunity work.",
        ],
    }
}
