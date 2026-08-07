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

export async function assertProjectMutationAccess(project_id: string, user_id: string) {
    const project = await assertProjectAccess(project_id, user_id)
    
    // Check if the user is accessing this project via a CLIENT_VIEWER link
    if (project.user_id !== user_id) {
        const prismaClient = (await import("../../lib/prisma")).default
        const link = await prismaClient.agencyClientLink.findFirst({
            where: {
                agency_user_id: project.user_id,
                client_user_id: user_id,
                status: 'ACTIVE'
            },
            select: { role: true }
        })

        if (link?.role === 'CLIENT_VIEWER') {
            throw Object.assign(new Error("Read-only access: Client viewers cannot modify projects or prompts."), { status: 403 })
        }
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

export async function assertCompetitorMutationAccess(competitor_id: string, user_id: string) {
    const competitor = await assertCompetitorAccess(competitor_id, user_id)
    const prismaClient = (await import("../../lib/prisma")).default
    const project = await prismaClient.project.findUnique({ where: { id: competitor.project_id } })
    if (project) await assertProjectMutationAccess(project.id, user_id)
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

export async function assertPromptMutationAccess(prompt_id: string, user_id: string) {
    const prompt = await assertPromptAccess(prompt_id, user_id)
    await assertProjectMutationAccess(prompt.project_id, user_id)
    return prompt
}
