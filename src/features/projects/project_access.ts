import {
    assertAgencyProjectAccess,
    assertAgencyCompetitorAccess,
    assertAgencyRunAccess,
    assertAgencyPromptAccess,
} from "../../lib/agency_access"

export async function assertProjectAccess(project_id: string, user_id: string) {
    const project = await assertAgencyProjectAccess(project_id, user_id)
    if (!project) {
        throw new Error("PROJECT_NOT_FOUND")
    }
    return project
}

export async function assertCompetitorAccess(competitor_id: string, user_id: string) {
    const competitor = await assertAgencyCompetitorAccess(competitor_id, user_id)
    if (!competitor) {
        throw new Error("COMPETITOR_NOT_FOUND")
    }
    return competitor
}

export async function assertRunAccess(run_id: string, user_id: string) {
    const run = await assertAgencyRunAccess(run_id, user_id)
    if (!run) {
        throw new Error("RUN_NOT_FOUND")
    }
    return run
}

export async function assertPromptAccess(prompt_id: string, user_id: string) {
    const prompt = await assertAgencyPromptAccess(prompt_id, user_id)
    if (!prompt) {
        throw new Error("PROMPT_NOT_FOUND")
    }
    return prompt
}
