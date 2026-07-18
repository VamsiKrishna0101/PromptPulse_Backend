import "../src/lib/env"
import prisma from "../src/lib/prisma"

const runId = process.argv[2]

if (!runId) {
    console.error("Usage: tsx scratch/check_run_status.ts <run_id>")
    process.exit(1)
}

const jobs = await prisma.scrapeJob.findMany({
    where: { run_id: runId },
    orderBy: { created_at: "asc" },
    select: {
        id: true,
        engine: true,
        status: true,
        chat_id: true,
        answer_text: true,
        citations: true,
        error_reason: true,
        started_at: true,
        completed_at: true,
        chat: {
            select: {
                id: true,
                ai_model: true,
                raw_response: true,
                display_response: true,
                created_at: true,
                _count: {
                    select: {
                        sources: true,
                        brand_mentions: true,
                    },
                },
            },
        },
    },
})

const summary = jobs.map(job => ({
    id: job.id,
    engine: job.engine,
    status: job.status,
    chat_id: job.chat_id,
    job_answer_length: job.answer_text?.length ?? 0,
    job_citation_count: Array.isArray(job.citations) ? job.citations.length : 0,
    error_reason: job.error_reason,
    started_at: job.started_at,
    completed_at: job.completed_at,
    saved_chat: job.chat
        ? {
            id: job.chat.id,
            ai_model: job.chat.ai_model,
            raw_response_length: job.chat.raw_response.length,
            display_response_length: job.chat.display_response?.length ?? 0,
            source_rows: job.chat._count.sources,
            brand_mentions: job.chat._count.brand_mentions,
            preview: job.chat.raw_response.slice(0, 300),
            created_at: job.chat.created_at,
        }
        : null,
}))

console.log(JSON.stringify(summary, null, 2))

await prisma.$disconnect()
