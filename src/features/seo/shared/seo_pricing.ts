export const DATAFORSEO_SERP_STANDARD_NORMAL_USD_PER_10 = 0.0006

export function serpStandardEstimate(input: { tasks: number; depth: number; sandbox: boolean }) {
    if (input.sandbox) return 0
    const resultPages = Math.max(1, Math.ceil(input.depth / 10))
    return input.tasks * resultPages * DATAFORSEO_SERP_STANDARD_NORMAL_USD_PER_10
}

export function serpStandardCredits(input: { tasks: number; depth: number; sandbox: boolean; creditsPerUsd: number; markup: number }) {
    return Math.ceil(serpStandardEstimate(input) * input.creditsPerUsd * input.markup)
}
