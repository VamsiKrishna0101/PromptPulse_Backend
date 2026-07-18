import "../lib/env"
import { Queue } from "bullmq"
import { createRedisConnection, getRedisConnectionOptions } from "../lib/redis"

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
    results.push(await clearScrapeCache())
    console.log(JSON.stringify(results, null, 2))
}

async function clearScrapeCache() {
    const redis = createRedisConnection()
    let cursor = "0"
    let deleted = 0

    try {
        do {
            const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "sc:v3:*", "COUNT", 500)
            cursor = nextCursor
            if (keys.length) {
                deleted += await redis.del(...keys)
            }
        } while (cursor !== "0")

        return { queue: "scrape-cache:sc:v3", cleared: true, deleted }
    } finally {
        await redis.quit()
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
