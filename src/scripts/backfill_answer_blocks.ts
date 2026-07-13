import "dotenv/config"
import { Prisma } from "@prisma/client"
import prisma from "../lib/prisma"
import { normalizeAnswerBlocks } from "../features/dashboard/answer_block_normalizer"

async function main() {
    const chats = await prisma.chat.findMany({
        where: { answer_blocks: { equals: Prisma.DbNull } },
        select: {
            id: true,
            raw_response: true,
            brand_mentions: { select: { brand_name: true } },
        },
    })

    let updated = 0

    for (const chat of chats) {
        await prisma.chat.update({
            where: { id: chat.id },
            data: {
                answer_blocks: normalizeAnswerBlocks(
                    chat.raw_response,
                    chat.brand_mentions.map(mention => mention.brand_name)
                ),
            },
        })
        updated += 1
    }

    console.log(JSON.stringify({ ok: true, updated }, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
