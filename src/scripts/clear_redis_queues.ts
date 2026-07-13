import "dotenv/config"
import { Queue } from "bullmq"
import { getRedisConnectionOptions } from "../lib/redis"

const QUEUES = [
    "ai-visibility-scrape",
    "ai-visibility-source-enrichment",
]

async function clearQueue(name: string) {
    const queue = new Queue(name, {
        connection: getRedisConnectionOptions(),
    })

    try {
        await queue.pause()
        await queue.obliterate({ force: true })
        return { queue: name, cleared: true }
    } finally {
        await queue.close()
    }
}

async function main() {
    const results = []
    for (const queue of QUEUES) {
        results.push(await clearQueue(queue))
    }
    console.log(JSON.stringify(results, null, 2))
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
