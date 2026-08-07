export const SCRAPING_DISABLED_ERROR = "SCRAPING_DISABLED"

export function isScrapingDisabled() {
    return process.env.SCRAPING_DISABLED === "true"
}

export function assertScrapingEnabled() {
    if (isScrapingDisabled()) {
        throw new Error(SCRAPING_DISABLED_ERROR)
    }
}
