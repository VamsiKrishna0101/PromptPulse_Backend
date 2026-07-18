import Redis from "ioredis"

function getRedisTlsOptions(enabled: boolean) {
    if (!enabled) return undefined

    return {
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED === "true"
    }
}

export function getRedisConnectionOptions() {
    if (process.env.REDIS_HOST) {
        return {
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT ?? 6379),
            username: process.env.REDIS_USERNAME || undefined,
            password: process.env.REDIS_PASSWORD || undefined,
            tls: getRedisTlsOptions(process.env.REDIS_TLS === "true"),
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
        tls: getRedisTlsOptions(url.protocol === "rediss:"),
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
