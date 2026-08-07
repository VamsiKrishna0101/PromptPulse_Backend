import axios, { AxiosError } from "axios"
import { SeoError } from "../shared/seo_errors"
import type {
    DataForSeoCall,
    DataForSeoEnvelope,
    DataForSeoEnvironment,
    DataForSeoTask,
} from "./dataforseo_types"

const REQUEST_TIMEOUT_MS = 60_000
const RETRY_DELAYS_MS = [250, 750]

function readCredentials(): { username: string; password: string } {
    const username =
        process.env.DATAFORSEO_API_LOGIN?.trim() ||
        process.env.DATAFORSEO_LOGIN?.trim()
    const password =
        process.env.DATAFORSEO_API_PASSWORD?.trim() ||
        process.env.DATAFORSEO_PASSWORD?.trim()

    if (username && password) return { username, password }

    const encoded = process.env.DATAFORSEO_API_KEY?.trim()
    if (encoded) {
        try {
            const decoded = Buffer.from(encoded, "base64").toString("utf8")
            const separator = decoded.indexOf(":")
            if (separator > 0) {
                return {
                    username: decoded.slice(0, separator),
                    password: decoded.slice(separator + 1),
                }
            }
        } catch {
            // The configured value is validated by the error below.
        }
    }

    throw new SeoError(
        "DATAFORSEO_NOT_CONFIGURED",
        "DataForSEO credentials are not configured",
        503,
    )
}

function providerEnvironment(): DataForSeoEnvironment {
    return process.env.DATAFORSEO_ENV?.trim().toLowerCase() === "sandbox"
        ? "sandbox"
        : "production"
}

function baseUrl(environment: DataForSeoEnvironment) {
    return environment === "sandbox"
        ? "https://sandbox.dataforseo.com"
        : "https://api.dataforseo.com"
}

function isNoResults(task: DataForSeoTask<unknown>) {
    return task.status_message?.toLowerCase().includes("no search results") ?? false
}

function safeProviderMessage(value: unknown): string {
    if (typeof value === "string") return value.slice(0, 500)
    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>
        const message = record.status_message
        if (typeof message === "string") return message.slice(0, 500)
    }
    return "DataForSEO request failed"
}

function mapHttpError(error: unknown): never {
    if (error instanceof SeoError) throw error
    if (error instanceof AxiosError) {
        const status = error.response?.status
        if (status === 401) {
            throw new SeoError(
                "DATAFORSEO_AUTH_FAILED",
                "DataForSEO rejected the configured credentials",
                502,
            )
        }
        if (status === 429) {
            throw new SeoError(
                "DATAFORSEO_RATE_LIMITED",
                "DataForSEO rate limit reached; retry shortly",
                429,
            )
        }
        throw new SeoError(
            "DATAFORSEO_UPSTREAM_ERROR",
            safeProviderMessage(error.response?.data),
            502,
            { providerStatus: status ?? null },
        )
    }
    throw new SeoError(
        "DATAFORSEO_UPSTREAM_ERROR",
        error instanceof Error ? error.message : "DataForSEO request failed",
        502,
    )
}

async function postEnvelope<TResult>(
    path: string,
    payload: Record<string, unknown>,
): Promise<DataForSeoCall<TResult | null>> {
    const environment = providerEnvironment()
    const credentials = readCredentials()
    let lastError: unknown

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        try {
            const response = await axios.post<DataForSeoEnvelope<TResult>>(
                `${baseUrl(environment)}${path}`,
                [payload],
                {
                    auth: credentials,
                    timeout: REQUEST_TIMEOUT_MS,
                    headers: { "Content-Type": "application/json" },
                },
            )
            const envelope = response.data
            if (envelope.status_code !== 20000) {
                throw new SeoError(
                    "DATAFORSEO_UPSTREAM_ERROR",
                    envelope.status_message || "DataForSEO request failed",
                    502,
                )
            }

            const task = envelope.tasks?.[0]
            if (!task) {
                throw new SeoError(
                    "DATAFORSEO_UPSTREAM_ERROR",
                    "DataForSEO response did not contain a task",
                    502,
                )
            }
            if (task.status_code !== 20000 && !isNoResults(task)) {
                const message = task.status_message || "DataForSEO task failed"
                const lower = message.toLowerCase()
                if (lower.includes("authentication") || lower.includes("authorization")) {
                    throw new SeoError(
                        "DATAFORSEO_AUTH_FAILED",
                        "DataForSEO rejected the configured credentials",
                        502,
                    )
                }
                throw new SeoError(
                    "DATAFORSEO_UPSTREAM_ERROR",
                    message,
                    502,
                    { providerTaskStatus: task.status_code ?? null },
                )
            }

            return {
                data: task.result?.[0] ?? null,
                costUsd: Number(task.cost ?? 0),
                taskIds: task.id ? [task.id] : [],
                environment,
                paths: [task.path?.join("/") || path.replace(/^\//, "")],
            }
        } catch (error) {
            lastError = error
            const status = error instanceof AxiosError ? error.response?.status : undefined
            const retryable = status != null && status >= 500
            if (!retryable || attempt === RETRY_DELAYS_MS.length) break
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
        }
    }

    return mapHttpError(lastError)
}

async function postTaskBatch<TResult>(
    path: string,
    payload: Array<Record<string, unknown>>,
): Promise<DataForSeoCall<TResult | null>> {
    const environment = providerEnvironment()
    const credentials = readCredentials()
    try {
        const response = await axios.post<DataForSeoEnvelope<TResult>>(
            `${baseUrl(environment)}${path}`,
            payload,
            { auth: credentials, timeout: REQUEST_TIMEOUT_MS, headers: { "Content-Type": "application/json" } },
        )
        const envelope = response.data
        if (envelope.status_code !== 20000) {
            throw new SeoError("DATAFORSEO_UPSTREAM_ERROR", envelope.status_message || "DataForSEO request failed", 502)
        }
        const tasks = envelope.tasks ?? []
        const failed = tasks.find(task => task.status_code !== 20000 && task.status_code !== 20100)
        if (failed) throw new SeoError("DATAFORSEO_UPSTREAM_ERROR", failed.status_message || "DataForSEO task failed", 502)
        return {
            data: null,
            costUsd: tasks.reduce((sum, task) => sum + Number(task.cost ?? 0), 0),
            taskIds: tasks.flatMap(task => task.id ? [task.id] : []),
            environment,
            paths: [path.replace(/^\//, "")],
        }
    } catch (error) {
        return mapHttpError(error)
    }
}

async function getEnvelope<TResult>(path: string): Promise<DataForSeoCall<TResult | null>> {
    const environment = providerEnvironment()
    const credentials = readCredentials()
    try {
        const response = await axios.get<DataForSeoEnvelope<TResult>>(
            `${baseUrl(environment)}${path}`,
            { auth: credentials, timeout: REQUEST_TIMEOUT_MS },
        )
        const envelope = response.data
        if (envelope.status_code !== 20000) {
            throw new SeoError("DATAFORSEO_UPSTREAM_ERROR", envelope.status_message || "DataForSEO request failed", 502)
        }
        const task = envelope.tasks?.[0]
        if (!task) {
            throw new SeoError("DATAFORSEO_UPSTREAM_ERROR", "DataForSEO response did not contain a task", 502)
        }
        if (task.status_code !== 20000 && !isNoResults(task)) {
            throw new SeoError("DATAFORSEO_UPSTREAM_ERROR", task.status_message || "DataForSEO task failed", 502, {
                providerTaskStatus: task.status_code ?? null,
            })
        }
        return {
            data: task.result?.[0] ?? null,
            costUsd: Number(task.cost ?? 0),
            taskIds: task.id ? [task.id] : [],
            environment,
            paths: [task.path?.join("/") || path.replace(/^\//, "")],
        }
    } catch (error) {
        return mapHttpError(error)
    }
}

export const dataForSeoClient = {
    environment: providerEnvironment,
    domainRankOverview(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/domain_rank_overview/live",
            payload,
        )
    },
    historicalRankOverview(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/historical_rank_overview/live",
            payload,
        )
    },
    rankedKeywords(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/ranked_keywords/live",
            payload,
        )
    },
    relevantPages(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/relevant_pages/live",
            payload,
        )
    },
    competitorsDomain(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/competitors_domain/live",
            payload,
        )
    },
    domainIntersection(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/domain_intersection/live",
            payload,
        )
    },
    relatedKeywords(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/related_keywords/live",
            payload,
        )
    },
    keywordSuggestions(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/keyword_suggestions/live",
            payload,
        )
    },
    keywordIdeas(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/keyword_ideas/live",
            payload,
        )
    },
    keywordOverview(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/dataforseo_labs/google/keyword_overview/live",
            payload,
        )
    },
    backlinksSummary(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/backlinks/summary/live",
            payload,
        )
    },
    backlinksHistory(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/backlinks/history/live",
            payload,
        )
    },
    backlinksRows(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/backlinks/backlinks/live",
            payload,
        )
    },
    referringDomains(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/backlinks/referring_domains/live",
            payload,
        )
    },
    backlinkTopPages(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/backlinks/domain_pages_summary/live",
            payload,
        )
    },
    backlinkAnchors(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/backlinks/anchors/live",
            payload,
        )
    },
    backlinkCompetitors(payload: Record<string, unknown>) {
        return postEnvelope<Record<string, unknown>>(
            "/v3/backlinks/competitors/live",
            payload,
        )
    },
    organicSerpStandard(payload: Array<Record<string, unknown>>) {
        return postTaskBatch<Record<string, unknown>>(
            "/v3/serp/google/organic/task_post",
            payload,
        )
    },
    organicSerpTaskGet(taskId: string) {
        return getEnvelope<Record<string, unknown>>(
            `/v3/serp/google/organic/task_get/advanced/${encodeURIComponent(taskId)}`,
        )
    },
}
