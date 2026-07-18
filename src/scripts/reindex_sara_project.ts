import "dotenv/config"
import prisma from "../lib/prisma"
import { reindexSaraProject } from "../features/sara/sara_service"

function readLimit(name: string) {
    const value = Number(process.env[name])
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
}

async function main() {
    const targetProjectId = process.env.SARA_REINDEX_PROJECT_ID?.trim()
    const options = {
        chat_limit: readLimit("SARA_REINDEX_CHAT_LIMIT"),
        source_limit: readLimit("SARA_REINDEX_SOURCE_LIMIT")
    }

    const projects = targetProjectId
        ? await prisma.project.findMany({
            where: { id: targetProjectId },
            select: { id: true, brand_name: true }
        })
        : await prisma.project.findMany({
            orderBy: { created_at: "asc" },
            select: { id: true, brand_name: true }
        })

    const results = []
    for (const project of projects) {
        const result = await reindexSaraProject(project.id, options)
        results.push({
            project_id: project.id,
            brand_name: project.brand_name,
            ...result
        })
    }

    console.log(JSON.stringify({
        ok: true,
        requested_project_id: targetProjectId || null,
        projects_reindexed: results.length,
        results
    }, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
