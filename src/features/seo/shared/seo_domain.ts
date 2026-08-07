import { SeoError } from "./seo_errors"

export function normalizeDomain(value: string): string {
    const input = value.trim().toLowerCase()
    if (!input) {
        throw new SeoError("SEO_VALIDATION_ERROR", "Domain is required", 400)
    }

    try {
        const url = new URL(input.includes("://") ? input : `https://${input}`)
        const hostname = url.hostname.replace(/^www\./, "").replace(/\.$/, "")
        if (!hostname || !hostname.includes(".") || hostname.length > 253) {
            throw new Error("invalid hostname")
        }
        return hostname
    } catch {
        throw new SeoError("SEO_VALIDATION_ERROR", "Enter a valid domain", 400)
    }
}

export function relativeUrl(value: string | null | undefined): string | null {
    if (!value) return null
    try {
        const url = new URL(value)
        return `${url.pathname}${url.search}`
    } catch {
        return value.startsWith("/") ? value : null
    }
}

export function safeUrlPath(value: string): string {
    try {
        const url = new URL(value)
        return `${url.pathname}${url.search}`
    } catch {
        return value
    }
}
