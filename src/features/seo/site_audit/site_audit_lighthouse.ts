export interface LighthouseScore {
    performance: number | null
    accessibility: number | null
    bestPractices: number | null
    seo: number | null
}

export async function fetchLighthouseScores(
    url: string,
    strategy: "mobile" | "desktop" = "mobile",
    retryCount = 0
): Promise<LighthouseScore> {
    try {
        const apiKey = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY
        let apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy.toUpperCase()}&category=performance&category=accessibility&category=best-practices&category=seo`
        if (apiKey) {
            apiUrl += `&key=${encodeURIComponent(apiKey)}`
        }

        const response = await fetch(apiUrl)

        if (response.status === 429 && retryCount < 1) {
            console.warn(`Lighthouse API rate limited (429) for ${url}. Retrying in 2.5s...`)
            await new Promise((resolve) => setTimeout(resolve, 2500))
            return fetchLighthouseScores(url, strategy, retryCount + 1)
        }

        if (!response.ok) {
            console.warn(`Lighthouse API failed for ${url} with status ${response.status}`)
            return { performance: null, accessibility: null, bestPractices: null, seo: null }
        }

        const data = await response.json()
        const categories = data.lighthouseResult?.categories || {}

        const score = (value: unknown) => typeof value === "number"
            ? Math.round(value * 100)
            : null

        return {
            performance: score(categories.performance?.score),
            accessibility: score(categories.accessibility?.score),
            bestPractices: score(categories['best-practices']?.score),
            seo: score(categories.seo?.score),
        }
    } catch (error) {
        console.error(`Error fetching Lighthouse scores for ${url}:`, error)
        return { performance: null, accessibility: null, bestPractices: null, seo: null }
    }
}
