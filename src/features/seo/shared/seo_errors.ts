export type SeoErrorCode =
    | "SEO_VALIDATION_ERROR"
    | "SEO_PROJECT_NOT_FOUND"
    | "SEO_SNAPSHOT_NOT_FOUND"
    | "SEO_CONFLICT"
    | "DATAFORSEO_NOT_CONFIGURED"
    | "DATAFORSEO_AUTH_FAILED"
    | "DATAFORSEO_RATE_LIMITED"
    | "DATAFORSEO_UPSTREAM_ERROR"
    | "APIFY_NOT_CONFIGURED"
    | "APIFY_UPSTREAM_ERROR"
    | "SEO_INSUFFICIENT_CREDITS"

export class SeoError extends Error {
    constructor(
        public readonly code: SeoErrorCode,
        message: string,
        public readonly status: number,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message)
        this.name = "SeoError"
    }
}

export function toSeoErrorResponse(error: unknown): {
    status: number
    body: { error: string; code: SeoErrorCode; details?: Record<string, unknown> }
} {
    if (error instanceof SeoError) {
        return {
            status: error.status,
            body: {
                error: error.message,
                code: error.code,
                ...(error.details ? { details: error.details } : {}),
            },
        }
    }

    if (error instanceof Error && error.message === "PROJECT_NOT_FOUND") {
        return {
            status: 404,
            body: {
                error: "Project not found",
                code: "SEO_PROJECT_NOT_FOUND",
            },
        }
    }

    return {
        status: 500,
        body: {
            error: "SEO request failed",
            code: "DATAFORSEO_UPSTREAM_ERROR",
        },
    }
}
