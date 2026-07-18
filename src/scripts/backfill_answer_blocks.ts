import "dotenv/config"
import prisma from "../lib/prisma"
import { normalizeAnswerBlocks } from "../features/dashboard/answer_block_normalizer"

/**
 * Backfill script: re-runs normalizeAnswerBlocks on all existing chats using
 * the raw scraper response as the source of truth.
 *
 * Run with:  npm run backfill:answer-blocks
 */
async function main() {
    const chats = await prisma.chat.findMany({
        select: {
            id: true,
            raw_response: true,
            brand_mentions: { select: { brand_name: true } },
        },
        orderBy: { created_at: "desc" },
    })

    console.log(`Re-processing ${chats.length} chats...`)
    let updated = 0

    for (const chat of chats) {
        await prisma.chat.update({
            where: { id: chat.id },
            data: {
                display_response: null,
                answer_blocks: normalizeAnswerBlocks(
                    chat.raw_response,
                    chat.brand_mentions.map(m => m.brand_name)
                ),
            },
        })
        updated += 1

        if (updated % 50 === 0) {
            console.log(`  ${updated}/${chats.length} done...`)
        }
    }

    console.log(JSON.stringify({ ok: true, total: chats.length, updated }, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
