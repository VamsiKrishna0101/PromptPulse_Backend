import axios, { AxiosError } from "axios"
import crypto from "crypto"
import https from "https"

export type QdrantPayload = Record<string, unknown>

export type QdrantPoint = {
    id: string
    vector: number[]
    payload: QdrantPayload
}

export type QdrantSearchResult<TPayload extends QdrantPayload = QdrantPayload> = {
    id: string | number
    score: number
    payload?: TPayload
}

const QDRANT_URL = (process.env.QDRANT_URL ?? "http://127.0.0.1:6333").replace(/\/$/, "")
const QDRANT_API_KEY = process.env.QDRANT_API_KEY
export const SARA_COLLECTION = process.env.QDRANT_SARA_COLLECTION ?? "sara_knowledge_v1"
const SARA_KEYWORD_INDEXES = [
    "project_id",
    "user_id",
    "document_type",
    "source_entity",
    "source_entity_id"
]

const client = axios.create({
    baseURL: QDRANT_URL,
    headers: {
        "Content-Type": "application/json",
        ...(QDRANT_API_KEY ? { "api-key": QDRANT_API_KEY } : {})
    },
    httpsAgent: shouldAllowInsecureLocalTls()
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined,
    timeout: Number(process.env.QDRANT_TIMEOUT_MS ?? 30000)
})

export function stablePointId(input: string): string {
    const hash = crypto.createHash("sha256").update(input).digest("hex").slice(0, 32)
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`
}

export async function ensureSaraCollection(vectorSize: number) {
    try {
        await client.get(`/collections/${SARA_COLLECTION}`)
    } catch (error) {
        if (!isQdrantNotFound(error)) throw error
        await client.put(`/collections/${SARA_COLLECTION}`, {
            vectors: {
                size: vectorSize,
                distance: "Cosine"
            }
        })
    }

    await ensureSaraPayloadIndexes()
}

export async function ensureSaraPayloadIndexes() {
    for (const fieldName of SARA_KEYWORD_INDEXES) {
        await client.put(`/collections/${SARA_COLLECTION}/index`, {
            field_name: fieldName,
            field_schema: "keyword"
        }).catch(error => {
            if (isPayloadIndexAlreadyExists(error)) return
            throw error
        })
    }
}

export async function upsertSaraPoints(points: QdrantPoint[]) {
    if (points.length === 0) return
    await ensureSaraCollection(points[0].vector.length)

    await client.put(`/collections/${SARA_COLLECTION}/points`, {
        points
    }, {
        params: { wait: true }
    })
}

export async function deleteSaraPointsBySource(input: {
    project_id: string
    source_entity: string
    source_entity_id: string
}) {
    await ensureSaraPayloadIndexes()

    await client.post(`/collections/${SARA_COLLECTION}/points/delete`, {
        filter: {
            must: [
                match("project_id", input.project_id),
                match("source_entity", input.source_entity),
                match("source_entity_id", input.source_entity_id)
            ]
        }
    }, {
        params: { wait: true }
    })
}

export async function searchSaraKnowledge<TPayload extends QdrantPayload = QdrantPayload>(input: {
    vector: number[]
    user_id: string
    project_id: string
    limit?: number
    document_types?: string[]
}): Promise<QdrantSearchResult<TPayload>[]> {
    await ensureSaraCollection(input.vector.length)

    const must: QdrantPayload[] = [
        match("user_id", input.user_id),
        match("project_id", input.project_id)
    ]

    if (input.document_types?.length) {
        must.push({
            key: "document_type",
            match: { any: input.document_types }
        })
    }

    const response = await client.post(`/collections/${SARA_COLLECTION}/points/search`, {
        vector: input.vector,
        filter: { must },
        limit: input.limit ?? 8,
        with_payload: true
    })

    return response.data.result ?? []
}

function match(key: string, value: string) {
    return { key, match: { value } }
}

function isQdrantNotFound(error: unknown) {
    return error instanceof AxiosError && error.response?.status === 404
}

function isPayloadIndexAlreadyExists(error: unknown) {
    return error instanceof AxiosError
        && error.response?.status === 400
        && String(error.response.data?.status?.error ?? "").toLowerCase().includes("already exists")
}

function shouldAllowInsecureLocalTls() {
    return process.env.ALLOW_INSECURE_LOCAL_TLS === "true" || process.env.NODE_ENV !== "production"
}
