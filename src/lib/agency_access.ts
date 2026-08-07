/**
 * agency_access.ts
 *
 * Shared helpers for project/resource access that transparently supports
 * both direct owners and agency users with active client links.
 *
 * All access checks use a single query (no extra round-trips):
 *   WHERE resource.user_id = $user_id
 *     OR EXISTS (
 *       SELECT 1 FROM "AgencyClientLink"
 *       WHERE agency_user_id = $user_id
 *         AND client_user_id = resource.user_id
 *         AND status = 'ACTIVE'
 *     )
 */

import prisma from "./prisma"

// ─── Types ────────────────────────────────────────────────────────────────────

type NotFoundErrorCode =
    | "PROJECT_NOT_FOUND"
    | "COMPETITOR_NOT_FOUND"
    | "RUN_NOT_FOUND"
    | "PROMPT_NOT_FOUND"

function notFound(code: NotFoundErrorCode): Error {
    return Object.assign(new Error(code), { status: 404, code: code.toLowerCase() })
}

// ─── Client ID resolution ─────────────────────────────────────────────────────

/**
 * Returns all user_ids the caller can act on behalf of.
 * For a SINGLE account: just [user_id].
 * For an AGENCY account: [user_id, ...all ACTIVE linked client user_ids].
 */
export async function getAccessibleUserIds(user_id: string): Promise<string[]> {
    // 1. Direct active clients if caller is an agency owner
    const links = await prisma.agencyClientLink.findMany({
        where: { agency_user_id: user_id, status: "ACTIVE" },
        select: { client_user_id: true },
    })
    const clientIds = links.map(l => l.client_user_id)

    // 2. Active agencies if caller is an agency team member / staff
    const memberships = await prisma.agencyMembership.findMany({
        where: { member_user_id: user_id, status: "ACTIVE" },
        select: { agency_user_id: true },
    })
    const staffAgencyIds = memberships.map(m => m.agency_user_id)

    // 3. Active clients for those agencies (staff access)
    const staffClientLinks = staffAgencyIds.length
        ? await prisma.agencyClientLink.findMany({
            where: { agency_user_id: { in: staffAgencyIds }, status: "ACTIVE" },
            select: { client_user_id: true },
        })
        : []

    return [...new Set([
        user_id,
        ...clientIds,
        ...staffAgencyIds,
        ...staffClientLinks.map(l => l.client_user_id),
    ])]
}

/**
 * Returns specific project IDs assigned to this user as a client.
 */
export async function getAssignedProjectIds(client_user_id: string): Promise<string[]> {
    const links = await prisma.agencyClientLink.findMany({
        where: { client_user_id, status: "ACTIVE" },
        select: { assigned_project_ids: true },
    })
    return [...new Set(links.flatMap(l => l.assigned_project_ids || []))]
}

/**
 * Returns the ACTIVE client user_ids for an agency (excludes the agency itself).
 * Returns an empty array for non-agency users.
 */
export async function getAgencyClientIds(agency_user_id: string): Promise<string[]> {
    const links = await prisma.agencyClientLink.findMany({
        where: { agency_user_id, status: "ACTIVE" },
        select: { client_user_id: true },
    })
    return links.map(l => l.client_user_id)
}

// ─── Project access ───────────────────────────────────────────────────────────

export async function assertAgencyProjectAccess(project_id: string, user_id: string) {
    const accessibleUserIds = await getAccessibleUserIds(user_id)
    const assignedProjectIds = await getAssignedProjectIds(user_id)

    const project = await prisma.project.findFirst({
        where: {
            id: project_id,
            OR: [
                { user_id: { in: accessibleUserIds } },
                { id: { in: assignedProjectIds } }
            ]
        },
        select: {
            id: true,
            brand_name: true,
            brand_url: true,
            brand_location: true,
            user_id: true,
            created_at: true,
            updated_at: true,
        },
    })

    if (!project) throw notFound("PROJECT_NOT_FOUND")
    return project
}

// ─── Competitor access ────────────────────────────────────────────────────────

export async function assertAgencyCompetitorAccess(competitor_id: string, user_id: string) {
    const accessibleUserIds = await getAccessibleUserIds(user_id)
    const assignedProjectIds = await getAssignedProjectIds(user_id)

    const competitor = await prisma.competitor.findFirst({
        where: {
            id: competitor_id,
            project: {
                OR: [
                    { user_id: { in: accessibleUserIds } },
                    { id: { in: assignedProjectIds } }
                ]
            }
        },
    })

    if (!competitor) throw notFound("COMPETITOR_NOT_FOUND")
    return competitor
}

// ─── Run access ───────────────────────────────────────────────────────────────

export async function assertAgencyRunAccess(run_id: string, user_id: string) {
    const accessibleUserIds = await getAccessibleUserIds(user_id)
    const assignedProjectIds = await getAssignedProjectIds(user_id)

    const run = await prisma.run.findFirst({
        where: {
            id: run_id,
            project: {
                OR: [
                    { user_id: { in: accessibleUserIds } },
                    { id: { in: assignedProjectIds } }
                ]
            }
        },
    })

    if (!run) throw notFound("RUN_NOT_FOUND")
    return run
}

// ─── Prompt access ────────────────────────────────────────────────────────────

export async function assertAgencyPromptAccess(prompt_id: string, user_id: string) {
    const accessibleUserIds = await getAccessibleUserIds(user_id)
    const assignedProjectIds = await getAssignedProjectIds(user_id)

    const prompt = await prisma.prompt.findFirst({
        where: {
            id: prompt_id,
            project: {
                OR: [
                    { user_id: { in: accessibleUserIds } },
                    { id: { in: assignedProjectIds } }
                ]
            }
        },
    })

    if (!prompt) throw notFound("PROMPT_NOT_FOUND")
    return prompt
}
