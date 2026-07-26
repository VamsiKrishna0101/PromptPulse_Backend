import type { SeoIssueInput, SeoScores } from "./seo_types"

function scoreForCategory(issues: SeoIssueInput[], category: SeoIssueInput["category"]) {
    const categoryIssues = issues.filter(issue => issue.category === category)
    
    const issuesByTitle = new Map<string, { severity: string, count: number }>()
    for (const issue of categoryIssues) {
        const existing = issuesByTitle.get(issue.title)
        if (existing) {
            existing.count += 1
        } else {
            issuesByTitle.set(issue.title, { severity: issue.severity, count: 1 })
        }
    }

    const penalty = Array.from(issuesByTitle.values()).reduce((sum, group) => {
        const base = group.severity === "HIGH" ? 15 : group.severity === "MEDIUM" ? 8 : 3
        const scale = Math.min(10, Math.sqrt(group.count)) // small extra penalty for widespread issues
        return sum + base * (1 + (scale - 1) * 0.2)
    }, 0)

    return Math.max(0, Math.min(100, Math.round(100 - penalty)))
}

export function calculateSeoScores(issues: SeoIssueInput[]): SeoScores {
    const technical_score = scoreForCategory(issues, "TECHNICAL")
    const ai_readiness_score = scoreForCategory(issues, "AI_READINESS")
    const local_score = scoreForCategory(issues, "LOCAL")
    const content_score = scoreForCategory(issues, "CONTENT")
    const schema_score = scoreForCategory(issues, "SCHEMA")
    const overall_score = Math.round(
        technical_score * 0.22 +
        ai_readiness_score * 0.25 +
        local_score * 0.2 +
        content_score * 0.23 +
        schema_score * 0.1
    )

    return {
        overall_score,
        technical_score,
        ai_readiness_score,
        local_score,
        content_score,
        schema_score,
    }
}
