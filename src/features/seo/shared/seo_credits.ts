import { getCreditBalance, refundCredits, spendCredits } from "../../credits/credits_service"
import { InsufficientCreditsError } from "../../payments/credits_service"
import { getBillingAccountContext } from "../../payments/credits_service"
import { creditPolicyFor } from "../../payments/credits_config"
import { SeoError } from "./seo_errors"

const DEFAULT_COST_MARKUP = 1

function positiveNumber(value: string | undefined, fallback: number): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function providerCostToCredits(costUsd: number, environment: "sandbox" | "production", creditsPerUsd = 180): number {
    if (environment === "sandbox" || costUsd <= 0) return 0
    const markup = positiveNumber(process.env.SEO_DATA_COST_MARKUP, DEFAULT_COST_MARKUP)
    return Math.max(1, Math.ceil(costUsd * creditsPerUsd * markup))
}

async function seoPricing(userId: string) {
    const context = await getBillingAccountContext(userId)
    const defaultRate = creditPolicyFor(context.accountType).seo_provider_credits_per_usd
    const accountOverride = context.accountType === "AGENCY"
        ? process.env.SEO_DATA_AGENCY_CREDITS_PER_USD
        : process.env.SEO_DATA_INDIVIDUAL_CREDITS_PER_USD
    return {
        ...context,
        creditsPerUsd: positiveNumber(accountOverride, defaultRate),
    }
}

export async function assertSeoCreditsAvailable(userId: string, estimatedProviderMilliUsd: number) {
    if (estimatedProviderMilliUsd <= 0) return
    const pricing = await seoPricing(userId)
    const estimatedCredits = providerCostToCredits(estimatedProviderMilliUsd / 1000, "production", pricing.creditsPerUsd)
    const balance = await getCreditBalance(userId)
    if (balance.remaining < estimatedCredits) {
        throw new SeoError(
            "SEO_INSUFFICIENT_CREDITS",
            `This refresh needs approximately ${estimatedCredits} credits`,
            402,
            { required: estimatedCredits, available: balance.remaining },
        )
    }
}

export async function chargeSeoProviderCost(input: {
    userId: string
    projectId: string
    operation: string
    costUsd: number
    environment: "sandbox" | "production"
    taskIds: string[]
    provider?: "dataforseo" | "apify"
}) {
    const pricing = await seoPricing(input.userId)
    const credits = providerCostToCredits(input.costUsd, input.environment, pricing.creditsPerUsd)
    if (credits === 0) return { credits, idempotencyKey: null }

    const providerIdentity = input.taskIds.length
        ? input.taskIds.sort().join(":")
        : `${input.operation}:${input.projectId}:${input.costUsd}`
    const provider = input.provider ?? "dataforseo"
    const idempotencyKey = `seo:${provider}:${providerIdentity}`

    try {
        await spendCredits({
            userId: input.userId,
            amount: credits,
            action: "SEO_DATA_REFRESH",
            description: `SEO ${input.operation.replaceAll("_", " ")} data refresh`,
            idempotencyKey,
            metadata: {
                project_id: input.projectId,
                operation: input.operation,
                provider,
                provider_cost_usd: input.costUsd,
                pricing_version: "seo-account-v1-2026-08",
                billing_account_type: pricing.accountType,
                credits_per_provider_usd: pricing.creditsPerUsd,
                provider_task_ids: input.taskIds,
            },
        })
    } catch (error) {
        if (error instanceof InsufficientCreditsError) {
            const balance = await getCreditBalance(input.userId)
            throw new SeoError(
                "SEO_INSUFFICIENT_CREDITS",
                `This refresh costs ${credits} credits`,
                402,
                { required: credits, available: balance.remaining },
            )
        }
        throw error
    }

    return { credits, idempotencyKey }
}

export async function refundSeoProviderCharge(input: {
    userId: string
    projectId: string
    operation: string
    credits: number
    idempotencyKey: string | null
}) {
    if (input.credits <= 0 || !input.idempotencyKey) return
    await refundCredits({
        userId: input.userId,
        amount: input.credits,
        action: "SEO_DATA_REFRESH",
        description: `Refund for failed SEO ${input.operation.replaceAll("_", " ")} persistence`,
        idempotencyKey: input.idempotencyKey,
        metadata: {
            project_id: input.projectId,
            operation: input.operation,
        },
    })
}
