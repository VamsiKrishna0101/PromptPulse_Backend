import prisma from "../../../lib/prisma"
import { isBrightDataSerpConfigured, runBrightDataSerp } from "./brightdata_serp_client"
import type { BrightDataSerpRecord, SeoRankResultInput } from "./serp_types"

const DEFAULT_COUNTRY = "IN"
const DEFAULT_LANGUAGE = "en"
const MAX_KEYWORDS = 10

function host(value: string) {
    try { return new URL(value).hostname.replace(/^www\./i, "").toLowerCase() } catch { return "" }
}

function configuredCountry() {
    return (process.env.SEO_SERP_DEFAULT_COUNTRY ?? DEFAULT_COUNTRY).trim().toUpperCase()
}

function configuredLanguage() {
    return (process.env.SEO_SERP_DEFAULT_LANGUAGE ?? DEFAULT_LANGUAGE).trim().toLowerCase()
}

function rankForDomain(record: BrightDataSerpRecord, domain: string) {
    const match = record.organic.find(item => host(item.url) === domain || host(item.url).endsWith(`.${domain}`))
    return match ?? null
}

export function maxSerpKeywords() {
    return Math.max(1, Math.min(MAX_KEYWORDS, Number(process.env.SEO_SERP_MAX_KEYWORDS_PER_AUDIT ?? MAX_KEYWORDS)))
}

export async function trackSeoKeywordRanks(input: {
    projectId: string
    auditId: string
    targetUrl: string
    keywords: { keyword: string }[]
}) {
    if (!isBrightDataSerpConfigured()) return { enabled: false, checked: 0 }
    const targetDomain = host(input.targetUrl)
    if (!targetDomain) return { enabled: false, checked: 0 }

    const selected = input.keywords.slice(0, maxSerpKeywords())
    const requestInputs: SeoRankResultInput[] = selected.map(item => ({
        keyword: item.keyword,
        targetUrl: input.targetUrl,
        targetDomain,
        country: configuredCountry(),
        language: configuredLanguage(),
    }))
    await prisma.$transaction(async tx => {
        for (let index = 0; index < selected.length; index += 1) {
            const keyword = selected[index].keyword
            await tx.seoRankResult.upsert({
                where: { audit_id_keyword: { audit_id: input.auditId, keyword } },
                create: {
                    project_id: input.projectId,
                    audit_id: input.auditId,
                    keyword,
                    country: configuredCountry(),
                    language: configuredLanguage(),
                    target_domain: targetDomain,
                    status: "PENDING",
                },
                update: {
                    status: "PENDING",
                },
            })
        }
    })

    try {
        const records = await runBrightDataSerp(requestInputs)
        const recordByKeyword = new Map(records.filter(record => record.keyword).map(record => [record.keyword, record]))

        await prisma.$transaction(async tx => {
            for (let index = 0; index < selected.length; index += 1) {
                const keyword = selected[index].keyword
                const record = recordByKeyword.get(keyword) ?? records[index] ?? { organic: [], related_queries: [] }
                const match = rankForDomain(record, targetDomain)
                await tx.seoRankResult.update({
                    where: { audit_id_keyword: { audit_id: input.auditId, keyword } },
                    data: {
                        google_rank: match?.rank ?? null,
                        ranking_url: match?.url ?? null,
                        ranking_title: match?.title ?? null,
                        organic_results: record.organic.slice(0, 20),
                        related_queries: record.related_queries.slice(0, 8),
                        status: "COMPLETED",
                        error_reason: null,
                    },
                })
            }
        })
    } catch (error) {
        await prisma.seoRankResult.updateMany({
            where: { audit_id: input.auditId, status: "PENDING" },
            data: { status: "FAILED", error_reason: error instanceof Error ? error.message : "Unknown error" },
        })
        throw error
    }
    return { enabled: true, checked: selected.length }
}
