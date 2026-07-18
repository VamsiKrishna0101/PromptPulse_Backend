import "../lib/env"
import prisma from "../lib/prisma"
import { enrichSource } from "../features/sources/source_enrichment_service"

async function main() {
    const limit = Number(process.env.SOURCE_ENRICHMENT_JOB_LIMIT ?? 50)
    const sources = await prisma.source.findMany({
        where: {
            source_url_content_id: null,
            url: { not: "" },
        },
        orderBy: { created_at: "asc" },
        take: limit,
        select: { id: true, url: true },
    })

    const results = []
    const ingestSara = process.env.SOURCE_ENRICHMENT_INGEST_SARA !== "false"
    for (const source of sources) {
        try {
            const content = await enrichSource(source.id, { ingest_sara: ingestSara })
            results.push({
                source_id: source.id,
                url: source.url,
                status: content.fetch_status,
                content_length: content.content_length,
            })
        } catch (error) {
            results.push({
                source_id: source.id,
                url: source.url,
                status: "FAILED",
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }

    console.log(JSON.stringify({
        ok: true,
        processed: results.length,
        results,
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
