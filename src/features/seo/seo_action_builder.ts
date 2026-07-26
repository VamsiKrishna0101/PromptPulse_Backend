import type { SeoActionInput, SeoIssueInput } from "./seo_types"

function priorityFromSeverity(severity: SeoIssueInput["severity"]) {
    if (severity === "HIGH") return "HIGH" as const
    if (severity === "MEDIUM") return "MEDIUM" as const
    return "LOW" as const
}

function difficultyForCategory(category: SeoIssueInput["category"]) {
    if (category === "TECHNICAL" || category === "SCHEMA") return "MEDIUM" as const
    if (category === "CONTENT") return "MEDIUM" as const
    return "LOW" as const
}

export function buildSeoActions(issues: SeoIssueInput[], existingActions: SeoActionInput[] = []) {
    const issueActions = issues
        .sort((a, b) => b.priority_score - a.priority_score)
        .slice(0, 12)
        .map(issue => ({
            action_type: issue.category,
            title: issue.title,
            description: issue.recommendation,
            page_url: issue.page_url ?? null,
            priority: priorityFromSeverity(issue.severity),
            difficulty: difficultyForCategory(issue.category),
            related_prompt_ids: [],
            related_sources: [],
        }))

    const seen = new Set<string>()
    return [...existingActions, ...issueActions].filter(action => {
        const key = `${action.action_type}:${action.title}`.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
    }).slice(0, 18)
}
