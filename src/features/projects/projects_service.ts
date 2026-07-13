import prisma from "../../lib/prisma"

export async function getUserProjects(user_id: string) {
    return prisma.project.findMany({
        where: { user_id },
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
                            error_reason: true
                        },
                        orderBy: { created_at: "asc" }
                    }
                }
            }
        }
    })
}
