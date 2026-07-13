import "dotenv/config"
import prisma from "../../lib/prisma"
import { enqueueSourceEnrichment } from "../../queues/source_enrichment_queue"

const sources = await prisma.source.findMany({
    where: {
        source_url_content_id: null
    },
    select: { id: true },
    orderBy: { created_at: "desc" }
})

await Promise.all(sources.map((source, index) => enqueueSourceEnrichment(source.id, index * 1000)))

console.log(`Queued ${sources.length} sources for enrichment`)
await prisma.$disconnect()
process.exit(0)
