import "dotenv/config"
import prisma from "../lib/prisma"

/**
 * Backfill script: scans all existing chats for subreddit / Quora mentions
 * and injects reddit.com / quora.com as UGC sources where missing.
 *
 * Run with:  npx tsx src/scripts/backfill_forum_sources.ts
 */

async function main() {
    const chats = await prisma.chat.findMany({
        select: {
            id: true,
            raw_response: true,
            sources: { select: { domain: true } },
        },
    })

    console.log(`Scanning ${chats.length} chats for forum mentions...`)

    let redditAdded = 0
    let quoraAdded = 0

    for (const chat of chats) {
        const text = chat.raw_response ?? ""
        const existingDomains = new Set(chat.sources.map(s => s.domain))

        const toCreate: { chat_id: string; url: string; domain: string; source_type: string; is_cited: boolean }[] = []

        // r/SaaS, r/MachineLearning etc. → reddit.com
        if (/\br\/[A-Za-z0-9_]+\b/.test(text) && !existingDomains.has("reddit.com")) {
            toCreate.push({
                chat_id: chat.id,
                url: "https://reddit.com",
                domain: "reddit.com",
                source_type: "UGC",
                is_cited: true,
            })
            redditAdded++
        }

        // Quora mention → quora.com
        if (/\bquora\.com\b|\bQuora\b/i.test(text) && !existingDomains.has("quora.com")) {
            toCreate.push({
                chat_id: chat.id,
                url: "https://quora.com",
                domain: "quora.com",
                source_type: "UGC",
                is_cited: true,
            })
            quoraAdded++
        }

        if (toCreate.length > 0) {
            await prisma.source.createMany({ data: toCreate })
        }
    }

    console.log(JSON.stringify({ ok: true, reddit_added: redditAdded, quora_added: quoraAdded }, null, 2))
}

main()
    .catch(err => {
        console.error(err)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
