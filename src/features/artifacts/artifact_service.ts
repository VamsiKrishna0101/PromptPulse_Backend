import crypto from "crypto"
import fs from "fs"
import prisma from "../../lib/prisma"

type CachedSignedUrl = {
    url: string
    expires_at: number
}

const signedUrlCache = new Map<string, CachedSignedUrl>()

function parseGsUri(uri: string) {
    const match = uri.match(/^gs:\/\/([^/]+)\/(.+)$/)
    if (!match) return null
    return {
        bucket: match[1],
        object: match[2],
    }
}

function encodeObjectPath(objectName: string) {
    return objectName.split("/").map(segment => encodeURIComponent(segment)).join("/")
}

function formatAmzDate(date: Date) {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, "")
}

function sha256Hex(value: string) {
    return crypto.createHash("sha256").update(value).digest("hex")
}

function loadServiceAccount() {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
    if (!keyPath) throw new Error("GOOGLE_APPLICATION_CREDENTIALS is not configured")
    const raw = fs.readFileSync(keyPath, "utf8")
    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string }
    if (!parsed.client_email || !parsed.private_key) {
        throw new Error("Google service account key is missing client_email or private_key")
    }
    return parsed
}

function signGcsUrl(input: {
    bucket: string
    objectName: string
    expiresInSeconds: number
}) {
    const serviceAccount = loadServiceAccount()
    const now = new Date()
    const timestamp = formatAmzDate(now)
    const dateStamp = timestamp.slice(0, 8)
    const credentialScope = `${dateStamp}/auto/storage/goog4_request`
    const credential = `${serviceAccount.client_email}/${credentialScope}`
    const host = `${input.bucket}.storage.googleapis.com`
    const canonicalUri = `/${encodeObjectPath(input.objectName)}`
    const canonicalQuery = [
        ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
        ["X-Goog-Credential", credential],
        ["X-Goog-Date", timestamp],
        ["X-Goog-Expires", String(input.expiresInSeconds)],
        ["X-Goog-SignedHeaders", "host"],
    ]
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join("&")
    const canonicalHeaders = `host:${host}\n`
    const canonicalRequest = [
        "GET",
        canonicalUri,
        canonicalQuery,
        canonicalHeaders,
        "host",
        "UNSIGNED-PAYLOAD",
    ].join("\n")
    const stringToSign = [
        "GOOG4-RSA-SHA256",
        timestamp,
        credentialScope,
        sha256Hex(canonicalRequest),
    ].join("\n")
    const signature = crypto.sign("RSA-SHA256", Buffer.from(stringToSign), serviceAccount.private_key).toString("hex")
    return `https://${host}${canonicalUri}?${canonicalQuery}&X-Goog-Signature=${signature}`
}

export async function getChatArtifactSignedUrl(input: {
    chat_id: string
    user_id: string
}) {
    const chat = await prisma.chat.findFirst({
        where: {
            id: input.chat_id,
            prompt: {
                project: {
                    user_id: input.user_id,
                },
            },
        },
        select: {
            id: true,
            screenshot_path: true,
            created_at: true,
        },
    })

    if (!chat) throw new Error("CHAT_NOT_FOUND")
    if (!chat.screenshot_path) throw new Error("ARTIFACT_NOT_FOUND")

    const parsed = parseGsUri(chat.screenshot_path)
    if (!parsed) throw new Error("ARTIFACT_NOT_CLOUD_BACKED")

    const retentionHours = Number(process.env.ARTIFACT_RETENTION_HOURS ?? 24)
    const artifactExpiresAt = chat.created_at.getTime() + retentionHours * 60 * 60 * 1000
    const now = Date.now()
    if (artifactExpiresAt <= now) throw new Error("ARTIFACT_EXPIRED")

    const cacheKey = chat.screenshot_path
    const cached = signedUrlCache.get(cacheKey)
    if (cached && cached.expires_at - 30_000 > now) {
        return {
            url: cached.url,
            expires_at: new Date(cached.expires_at).toISOString(),
            cached: true,
        }
    }

    const configuredTtl = Number(process.env.ARTIFACT_SIGNED_URL_TTL_SECONDS ?? 600)
    const ttlSeconds = Math.max(60, Math.min(configuredTtl, Math.floor((artifactExpiresAt - now) / 1000)))
    const url = signGcsUrl({
        bucket: parsed.bucket,
        objectName: parsed.object,
        expiresInSeconds: ttlSeconds,
    })
    const expiresAt = now + ttlSeconds * 1000
    signedUrlCache.set(cacheKey, { url, expires_at: expiresAt })

    return {
        url,
        expires_at: new Date(expiresAt).toISOString(),
        cached: false,
    }
}
