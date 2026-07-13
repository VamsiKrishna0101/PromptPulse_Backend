import Redis from "ioredis"

export function getRedisConnectionOptions() {
    if (process.env.REDIS_HOST) {
        return {
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT ?? 6379),
            username: process.env.REDIS_USERNAME || undefined,
            password: process.env.REDIS_PASSWORD || undefined,
            tls: process.env.REDIS_TLS === "true" ? {} : undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false
        }
    }

    const url = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:6379")

    return {
        host: url.hostname,
        port: Number(url.port || 6379),
        username: url.username || undefined,
        password: url.password || undefined,
        tls: url.protocol === "rediss:" ? {} : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false
    }
}

export function createRedisConnection() {
    return new Redis(getRedisConnectionOptions())
}

export async function closeRedisConnection() {
    const redis = createRedisConnection()
    await redis.quit()
}
