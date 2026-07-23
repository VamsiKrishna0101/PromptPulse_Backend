import prisma from "../../lib/prisma"
import { getAccessibleUserIds } from '../../lib/agency_access'

export async function getUserProjects(user_id: string) {
    // For agency accounts this returns own projects + all active client projects.
    // For single accounts this is just [user_id] so behaviour is unchanged.
    const accessibleIds = await getAccessibleUserIds(user_id)

    return prisma.project.findMany({
        where: { user_id: { in: accessibleIds } },
        orderBy: { created_at: "asc" },
        include: {
            prompts: {
                select: {
                    id: true,
                    text: true,
                    topic: true,
                    type: true,
                    status: true,
                    is_active: true,
                    last_run_at: true,
                    geo_variants: {
                        where: { is_active: true },
                        select: {
                            id: true,
                            country_code: true,
                            country_name: true,
                            city: true
                        }
                    }
                },
                orderBy: { created_at: "asc" }
            },
            competitors: {
                select: {
                    id: true,
                    name: true
                },
                orderBy: { created_at: "asc" }
            },
            engine_preferences: {
                where: { is_active: true },
                select: {
                    engine: true
                },
                orderBy: { created_at: "asc" }
            },
            runs: {
                take: 1,
                orderBy: { ran_at: "desc" },
                include: {
                    scrape_jobs: {
                        select: {
                            id: true,
                            engine: true,
                            status: true,
                            prompt_id: true,
                            completed_at: true,
                            created_at: true,
                            error_reason: true,
                            retry_count: true,
                            chat_id: true,
                            geo_country_code: true,
                            geo_city: true
                        },
                        orderBy: { created_at: "asc" }
                    }
                }
            }
        }
    })
}
