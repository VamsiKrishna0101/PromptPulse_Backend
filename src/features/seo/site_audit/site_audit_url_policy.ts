import { isIP } from "node:net"
import { lookup } from "node:dns/promises"
import { SeoError } from "../shared/seo_errors"

const BLOCKED_HOSTS = new Set([
    "localhost",
    "metadata",
    "metadata.google.internal",
    "169.254.169.254",
    "100.100.100.200",
])

function privateIpv4(address: string) {
    const parts = address.split(".").map(Number)
    if (parts.length !== 4 || parts.some(value => !Number.isInteger(value))) return false
    const [a, b] = parts
    return a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        a >= 224
}

function privateIpv6(address: string) {
    const value = address.toLowerCase().replace(/^\[|\]$/g, "")
    return value === "::" ||
        value === "::1" ||
        value.startsWith("fc") ||
        value.startsWith("fd") ||
        /^fe[89ab]/.test(value) ||
        (value.startsWith("::ffff:") && privateIpv4(value.slice(7)))
}

function blockedHostname(hostname: string) {
    const host = hostname.toLowerCase().replace(/\.$/, "")
    if (
        BLOCKED_HOSTS.has(host) ||
        [".localhost", ".local", ".localdomain", ".internal", ".home.arpa"]
            .some(suffix => host.endsWith(suffix))
    ) return true
    const family = isIP(host)
    return family === 4 ? privateIpv4(host) : family === 6 ? privateIpv6(host) : false
}

export function normalizeAuditUrl(value: string, base?: string): string | null {
    try {
        const raw = base || /^https?:\/\//i.test(value) ? value : `https://${value}`
        const url = base ? new URL(value, base) : new URL(raw)
        if (!["http:", "https:"].includes(url.protocol) || blockedHostname(url.hostname)) {
            return null
        }
        url.pathname = url.pathname.replace(/\/{2,}/g, "/")
        for (const key of [...url.searchParams.keys()]) {
            if (/^(utm_|gclid$|fbclid$|msclkid$)/i.test(key)) url.searchParams.delete(key)
        }
        url.searchParams.sort()
        url.hash = ""
        return url.toString()
    } catch {
        return null
    }
}

export async function validateAuditStartUrl(value: string) {
    const normalized = normalizeAuditUrl(value)
    if (!normalized) {
        throw new SeoError("SEO_VALIDATION_ERROR", "Enter a public HTTP or HTTPS URL", 400)
    }
    const url = new URL(normalized)
    try {
        const addresses = await lookup(url.hostname, { all: true })
        if (
            !addresses.length ||
            addresses.some(({ address, family }) =>
                family === 4 ? privateIpv4(address) : privateIpv6(address),
            )
        ) {
            throw new SeoError("SEO_VALIDATION_ERROR", "Private network URLs cannot be audited", 400)
        }
    } catch (error) {
        if (error instanceof SeoError) throw error
        throw new SeoError("SEO_VALIDATION_ERROR", "The audit domain could not be resolved", 400)
    }
    return normalized
}

export function sameOrigin(url: string, origin: string) {
    try {
        return new URL(url).origin === origin
    } catch {
        return false
    }
}

export function isAllowedByRobotsTxt(urlStr: string, robotsTxtRaw: string | null, userAgent: string = "*"): boolean {
    if (!robotsTxtRaw) return true
    
    try {
        const url = new URL(urlStr)
        const path = url.pathname + url.search

        const lines = robotsTxtRaw.split("\n").map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith("#"))
        
        let currentUserAgentMatches = false
        let isAllowed = true

        for (const line of lines) {
            const splitIndex = line.indexOf(":")
            if (splitIndex === -1) continue
            
            const key = line.slice(0, splitIndex).trim().toLowerCase()
            const value = line.slice(splitIndex + 1).trim()

            if (key === "user-agent") {
                currentUserAgentMatches = value === "*" || value.toLowerCase() === userAgent.toLowerCase()
            } else if (currentUserAgentMatches) {
                if (key === "disallow" && value) {
                    if (path.startsWith(value)) {
                        isAllowed = false
                    }
                } else if (key === "allow" && value) {
                    if (path.startsWith(value)) {
                        isAllowed = true
                    }
                }
            }
        }
        return isAllowed
    } catch {
        return true
    }
}
