function normalizeDomain(brandUrl: string) {
    try {
        return new URL(brandUrl.startsWith("http") ? brandUrl : `https://${brandUrl}`).hostname
    } catch {
        return ""
    }
}

export async function fetchBrandLogo(brandUrl: string): Promise<Buffer | null> {
    const domain = normalizeDomain(brandUrl)
    if (!domain) return null

    const candidates = [
        `https://${domain}/apple-touch-icon.png`,
        `https://${domain}/favicon.ico`,
        `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
    ]

    for (const url of candidates) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(3500) })
            if (!response.ok) continue
            const contentType = response.headers.get("content-type") ?? ""
            if (!contentType.includes("image/")) continue
            return Buffer.from(await response.arrayBuffer())
        } catch {
            // Try the next brand-owned or fallback asset.
        }
    }
    return null
}
