import crypto from "node:crypto"
import type { Prisma } from "@prisma/client"
import prisma from "../../../lib/prisma"
import { assertProjectAccess } from "../../projects/project_access"
import { getCreditBalance } from "../../credits/credits_service"
import {
    refreshCompetitorsSnapshot,
    refreshKeywordGapSnapshot,
    refreshOrganicKeywordsSnapshot,
    refreshOverview,
    refreshTopPagesSnapshot,
} from "../domain_research/domain_research_service"
import { probeWebsite } from "./website_probe"
import type { OnboardingInput, OnboardingTier, WebsiteProbeResult } from "./onboarding_types"
import { backlinksService } from "../backlinks/backlinks_service"
import { getGscBaseline } from "./gsc_baseline"
import { archiveOnboardingPrompts, startAiVisibilityBaseline, summarizeAiVisibility } from "./ai_visibility_baseline"
import { SiteAuditService } from "../site_audit/site_audit_service"

export const TIER_CREDIT_CONFIGS: Record<OnboardingTier, { maxCredits: number; maxPages: number; keywordLimit: number; promptCount: number; aiVisibility: boolean }> = {
    quick: { maxCredits: 40, maxPages: 10, keywordLimit: 20, promptCount: 0, aiVisibility: false },
    standard: { maxCredits: 100, maxPages: 25, keywordLimit: 50, promptCount: 6, aiVisibility: true },
    deep: { maxCredits: 180, maxPages: 50, keywordLimit: 100, promptCount: 8, aiVisibility: true },
}

function record(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}
}

function resolveTierConfig(input: OnboardingInput) {
    const tier: OnboardingTier = input.tier ?? "standard"
    const base = TIER_CREDIT_CONFIGS[tier] ?? TIER_CREDIT_CONFIGS.standard
    const maxCredits = input.max_credits ? Math.max(input.max_credits, 20) : base.maxCredits
    const maxPages = input.max_pages ? Math.min(Math.max(input.max_pages, 1), 50) : base.maxPages
    const runAi = input.run_ai_visibility ?? base.aiVisibility
    const promptCount = runAi ? Math.min(Math.max(input.ai_prompt_count ?? base.promptCount, 1), 8) : 0

    return {
        tier,
        maxCredits,
        maxPages,
        keywordLimit: base.keywordLimit,
        runAiVisibility: runAi,
        aiPromptCount: promptCount,
        includeBacklinks: input.include_backlinks !== false,
        includeProviderResearch: input.include_provider_research !== false,
    }
}

function inputJson(input: OnboardingInput, config: ReturnType<typeof resolveTierConfig>) {
    return {
        tier: config.tier,
        country: input.country,
        language_code: input.language_code ?? "en",
        services: input.services ?? [],
        target_audience: input.target_audience ?? null,
        goals: input.goals ?? [],
        competitor_domains: input.competitor_domains ?? [],
        max_pages: config.maxPages,
        max_credits: config.maxCredits,
        include_provider_research: config.includeProviderResearch,
        include_backlinks: config.includeBacklinks,
        run_ai_visibility: config.runAiVisibility,
        ai_prompt_count: config.aiPromptCount,
    }
}

async function updateRun(runId: string, data: {
    current_step?: string
    progress_percent?: number
    status?: string
    credits_spent?: number
    provider_cost_usd?: number
    summary?: Prisma.InputJsonValue | null
    cost_breakdown?: Prisma.InputJsonValue
    audit_id?: string | null
    visibility_run_id?: string | null
    attempt_count?: number
    error_reason?: string | null
    started_at?: Date
    completed_at?: Date
}) {
    return prisma.seoOnboardingRun.update({ where: { id: runId }, data: data as any })
}

async function finding(runId: string, data: { category: string; title: string; summary: string; severity?: string; evidence?: unknown }) {
    return prisma.seoOnboardingFinding.create({
        data: {
            run_id: runId,
            category: data.category,
            title: data.title,
            summary: data.summary,
            severity: data.severity ?? "INFO",
            evidence: (data.evidence ?? {}) as Prisma.InputJsonValue,
        },
    })
}

async function recommendation(runId: string, data: {
    title: string
    description: string
    category: string
    priority: string
    impact_score: number
    effort_score: number
    confidence_score: number
    recommended_action: string
    success_metric: string
    evidence: unknown
}) {
    return prisma.seoOnboardingRecommendation.create({
        data: { run_id: runId, ...data, evidence: data.evidence as Prisma.InputJsonValue },
    })
}

async function beginStep(runId: string, stepKey: string) {
    const existing = await prisma.seoOnboardingStep.findUnique({ where: { run_id_step_key: { run_id: runId, step_key: stepKey } } })
    if (existing?.status === "COMPLETED") return { completed: true, result: existing.result }
    await prisma.seoOnboardingStep.upsert({
        where: { run_id_step_key: { run_id: runId, step_key: stepKey } },
        create: { run_id: runId, step_key: stepKey, status: "RUNNING", attempts: 1, started_at: new Date() },
        update: { status: "RUNNING", attempts: { increment: 1 }, error_reason: null, started_at: new Date() },
    })
    return { completed: false, result: null }
}

async function completeStep(runId: string, stepKey: string, result: unknown) {
    await prisma.seoOnboardingStep.update({
        where: { run_id_step_key: { run_id: runId, step_key: stepKey } },
        data: { status: "COMPLETED", result: result as Prisma.InputJsonValue, completed_at: new Date(), error_reason: null },
    })
}

async function failStep(runId: string, stepKey: string, error: unknown) {
    const message = error instanceof Error ? error.message : "Step failed"
    await prisma.seoOnboardingStep.upsert({
        where: { run_id_step_key: { run_id: runId, step_key: stepKey } },
        create: { run_id: runId, step_key: stepKey, status: "FAILED", attempts: 1, error_reason: message, completed_at: new Date() },
        update: { status: "FAILED", error_reason: message, completed_at: new Date() },
    })
    return message
}

async function waitForAudit(auditId: string, timeoutMs = 12 * 60 * 1000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const audit = await prisma.seoAudit.findUnique({ where: { id: auditId }, include: { issues: true, pages: true } })
        if (!audit) throw new Error("Technical audit disappeared")
        if (audit.status === "COMPLETED") return audit
        if (audit.status === "FAILED") throw new Error(audit.error_reason ?? "Technical audit failed")
        await new Promise(resolve => setTimeout(resolve, 2_000))
    }
    throw new Error("Technical audit timed out")
}

function buildWebsiteFindings(runId: string, probe: WebsiteProbeResult) {
    const pagesWithoutTitles = probe.pages.filter(page => !page.title).map(page => page.url)
    const pagesWithoutDescriptions = probe.pages.filter(page => !page.meta_description).map(page => page.url)
    const pagesWithoutH1 = probe.pages.filter(page => !page.h1).map(page => page.url)
    const tasks = [
        pagesWithoutTitles.length ? finding(runId, { category: "TECHNICAL", title: "Pages are missing title tags", summary: `${pagesWithoutTitles.length} crawled page(s) do not have a title tag.`, severity: "HIGH", evidence: { urls: pagesWithoutTitles } }) : null,
        pagesWithoutDescriptions.length ? finding(runId, { category: "TECHNICAL", title: "Pages are missing meta descriptions", summary: `${pagesWithoutDescriptions.length} crawled page(s) do not have a meta description.`, severity: "MEDIUM", evidence: { urls: pagesWithoutDescriptions } }) : null,
        pagesWithoutH1.length ? finding(runId, { category: "TECHNICAL", title: "Pages are missing an H1 heading", summary: `${pagesWithoutH1.length} crawled page(s) do not have an H1 heading.`, severity: "MEDIUM", evidence: { urls: pagesWithoutH1 } }) : null,
        finding(runId, { category: "CRAWL", title: "Website crawl completed", summary: `Checked ${probe.pages.length} page(s); ${probe.failed_urls.length} URL(s) failed.`, severity: probe.failed_urls.length ? "MEDIUM" : "INFO", evidence: { pages: probe.pages, failed_urls: probe.failed_urls, sitemap_url: probe.sitemap_url } }),
    ].filter(Boolean) as Promise<unknown>[]
    return Promise.all(tasks)
}

async function buildRecommendations(runId: string, probe: WebsiteProbeResult | null, research: Record<string, any>, technicalScore?: number) {
    const pagesWithoutTitles = probe?.pages.filter(page => !page.title).map(page => page.url) ?? []
    const pagesWithoutDescriptions = probe?.pages.filter(page => !page.meta_description).map(page => page.url) ?? []

    if (pagesWithoutTitles.length) {
        await recommendation(runId, {
            title: "Fix missing title tags",
            description: "Add unique, descriptive title tags to the affected pages and include the primary service or topic where appropriate.",
            category: "TECHNICAL", priority: "HIGH", impact_score: 85, effort_score: 35, confidence_score: 95,
            recommended_action: "update_title_tags", success_metric: "All priority pages have unique title tags", evidence: { urls: pagesWithoutTitles },
        })
    }

    if (pagesWithoutDescriptions.length) {
        await recommendation(runId, {
            title: "Improve missing meta descriptions",
            description: "Write concise, intent-matched meta descriptions for pages that currently have none.",
            category: "TECHNICAL", priority: "MEDIUM", impact_score: 65, effort_score: 30, confidence_score: 90,
            recommended_action: "update_meta_descriptions", success_metric: "Priority pages have useful meta descriptions", evidence: { urls: pagesWithoutDescriptions },
        })
    }

    if (technicalScore !== undefined && technicalScore < 70) {
        await recommendation(runId, {
            title: "Resolve core technical health issues",
            description: `Site health is currently scored at ${technicalScore}/100. Address high-priority crawl and indexability blockers to maximize organic ranking potential.`,
            category: "TECHNICAL", priority: "HIGH", impact_score: 90, effort_score: 50, confidence_score: 95,
            recommended_action: "resolve_tech_issues", success_metric: "Raise technical health score above 85", evidence: { technicalScore },
        })
    }

    const keywordPayload = record(research.keywords)
    const keywordSummary = record(keywordPayload.summary)
    if (Number(keywordSummary.totalKeywords ?? 0) === 0) {
        await recommendation(runId, {
            title: "Build a measurable keyword baseline",
            description: "No organic keyword dataset was returned. Connect Search Console or run a broader keyword research pass before planning content.",
            category: "RESEARCH", priority: "HIGH", impact_score: 70, effort_score: 25, confidence_score: 80,
            recommended_action: "connect_search_console", success_metric: "A verified keyword baseline is available", evidence: { source: "keyword_research", summary: keywordSummary },
        })
    }

    if (research.keyword_gap) {
        await recommendation(runId, {
            title: "Target competitor keyword gaps",
            description: "Target high-intent keywords where direct competitors are ranking on page 1 but your domain has no presence.",
            category: "STRATEGY", priority: "HIGH", impact_score: 85, effort_score: 45, confidence_score: 85,
            recommended_action: "target_keyword_gaps", success_metric: "New landing pages or sections targeting gap keywords", evidence: { keyword_gap: research.keyword_gap },
        })
    }

    await recommendation(runId, {
        title: "Deploy 30-Day Quick Win SEO Plan",
        description: "Focus on fixing priority technical blockers and optimizing existing landing pages before launching new content campaigns.",
        category: "STRATEGY", priority: "HIGH", impact_score: 80, effort_score: 35, confidence_score: 90,
        recommended_action: "create_30_day_worklist", success_metric: "Priority action items scheduled in queue", evidence: { crawled_pages: probe?.pages.length ?? 0, research_available: Object.keys(research) },
    })
}

async function persistGscBaseline(runId: string, baseline: Awaited<ReturnType<typeof getGscBaseline>>) {
    if (!baseline.connected) {
        await finding(runId, {
            category: "GSC", title: "Google Search Console is not connected",
            summary: "The strategy audit uses public and provider data only until Search Console is connected.", severity: "MEDIUM", evidence: {},
        })
        return
    }
    await finding(runId, {
        category: "GSC", title: "Search Console baseline collected",
        summary: `${baseline.totals.clicks} clicks and ${baseline.totals.impressions} impressions were found in the last 90 days.`,
        severity: "INFO", evidence: baseline,
    })
    if (baseline.quick_wins.length) {
        await recommendation(runId, {
            title: "Optimize striking distance queries (Positions 8–30)",
            description: "Prioritize pages already ranking in positions 8–30 with meaningful impressions; these are the fastest evidence-backed ranking gains.",
            category: "CONTENT", priority: "HIGH", impact_score: 90, effort_score: 40, confidence_score: 95,
            recommended_action: "optimize_gsc_quick_wins", success_metric: "Push positions 8–30 into Top 5", evidence: { quick_wins: baseline.quick_wins },
        })
    }
    if (baseline.low_ctr.length) {
        await recommendation(runId, {
            title: "Improve SERP click-through rate on high-impression pages",
            description: "Rewrite titles and meta descriptions for pages that rank well but receive unusually few clicks (<3% CTR).",
            category: "CONTENT", priority: "HIGH", impact_score: 85, effort_score: 30, confidence_score: 90,
            recommended_action: "improve_serp_ctr", success_metric: "Increase organic CTR for target pages", evidence: { low_ctr: baseline.low_ctr },
        })
    }
}

/**
 * Executes all independent audit tasks concurrently in parallel (DAG model).
 * Drops total execution duration from ~4 minutes to ~30-40 seconds.
 */
async function executeOnboarding(runId: string, actorUserId: string) {
    const run = await prisma.seoOnboardingRun.findUnique({ where: { id: runId }, include: { project: true } })
    if (!run) return
    if (run.status === "WAITING_AI" || run.status === "COMPLETED") return

    const startedAt = new Date()
    await updateRun(runId, { status: "RUNNING", current_step: "RUNNING_PARALLEL_AUDIT", progress_percent: 15, started_at: run.started_at ?? startedAt, attempt_count: run.attempt_count + 1 })

    const input = record(run.input) as OnboardingInput
    const config = resolveTierConfig(input)
    const research: Record<string, any> = {}
    let probe: WebsiteProbeResult | null = null
    let technicalScore: number | undefined
    const failures: string[] = []
    const beforeBalance = (await getCreditBalance(actorUserId)).remaining

    const scope = {
        projectId: run.project_id,
        userId: actorUserId,
        domain: run.project.brand_url,
        country: String(input.country),
        languageCode: String(input.language_code ?? "en"),
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PARALLEL TASK STREAM 1: Website Crawler
    // ─────────────────────────────────────────────────────────────────────────
    const streamWebsite = (async () => {
        try {
            const step = await beginStep(runId, "WEBSITE_CRAWL")
            probe = step.completed ? (step.result as unknown as WebsiteProbeResult) : await probeWebsite(run.project.brand_url, config.maxPages)
            if (!step.completed) {
                await buildWebsiteFindings(runId, probe)
                await completeStep(runId, "WEBSITE_CRAWL", probe)
            }
        } catch (error) {
            const msg = await failStep(runId, "WEBSITE_CRAWL", error)
            failures.push(`website crawl: ${msg}`)
            await finding(runId, { category: "CRAWL", title: "Website crawl failed", summary: msg, severity: "CRITICAL", evidence: {} })
        }
    })()

    // ─────────────────────────────────────────────────────────────────────────
    // PARALLEL TASK STREAM 2: Technical Health & Lighthouse Audit
    // ─────────────────────────────────────────────────────────────────────────
    const streamTechAudit = (async () => {
        try {
            const step = await beginStep(runId, "TECHNICAL_AUDIT")
            if (!step.completed) {
                const audit = await SiteAuditService.startAudit(run.project_id, actorUserId, run.project.brand_url, config.maxPages)
                await updateRun(runId, { audit_id: audit.auditId })
                const completedAudit = await waitForAudit(audit.auditId)
                technicalScore = completedAudit.overall_score
                const technical = {
                    audit_id: completedAudit.id,
                    overall_score: completedAudit.overall_score,
                    pages: completedAudit.pages.length,
                    issues: completedAudit.issues.map(issue => ({ title: issue.title, category: issue.category, severity: issue.severity, recommendation: issue.recommendation, urls: [] })),
                }
                await completeStep(runId, "TECHNICAL_AUDIT", technical)
                await finding(runId, { category: "TECHNICAL", title: "Technical SEO audit completed", summary: `Technical score: ${completedAudit.overall_score}/100 across ${completedAudit.pages.length} page(s).`, severity: completedAudit.overall_score < 60 ? "HIGH" : "INFO", evidence: technical })
            }
        } catch (error) {
            const msg = await failStep(runId, "TECHNICAL_AUDIT", error)
            failures.push(`technical audit: ${msg}`)
        }
    })()

    // ─────────────────────────────────────────────────────────────────────────
    // PARALLEL TASK STREAM 3: Google Search Console Baseline
    // ─────────────────────────────────────────────────────────────────────────
    const streamGsc = (async () => {
        try {
            const step = await beginStep(runId, "SEARCH_CONSOLE")
            if (!step.completed) {
                const gsc = await getGscBaseline(run.project_id)
                await completeStep(runId, "SEARCH_CONSOLE", gsc)
                await persistGscBaseline(runId, gsc)
            }
        } catch (error) {
            const msg = await failStep(runId, "SEARCH_CONSOLE", error)
            failures.push(`search console: ${msg}`)
        }
    })()

    // ─────────────────────────────────────────────────────────────────────────
    // PARALLEL TASK STREAM 4: Domain Overview Snapshot
    // ─────────────────────────────────────────────────────────────────────────
    const streamDomainOverview = (async () => {
        if (!config.includeProviderResearch) return
        try {
            const step = await beginStep(runId, "DOMAIN_OVERVIEW")
            research.overview = step.completed ? step.result : await refreshOverview({ ...scope, range: 3 })
            if (!step.completed) await completeStep(runId, "DOMAIN_OVERVIEW", research.overview)
        } catch (error) {
            const msg = await failStep(runId, "DOMAIN_OVERVIEW", error)
            failures.push(`domain overview: ${msg}`)
        }
    })()

    // ─────────────────────────────────────────────────────────────────────────
    // PARALLEL TASK STREAM 5: Organic Keywords Snapshot
    // ─────────────────────────────────────────────────────────────────────────
    const streamOrganicKeywords = (async () => {
        if (!config.includeProviderResearch) return
        try {
            const step = await beginStep(runId, "ORGANIC_KEYWORDS")
            research.keywords = step.completed ? step.result : await refreshOrganicKeywordsSnapshot({ ...scope, limit: config.keywordLimit })
            if (!step.completed) await completeStep(runId, "ORGANIC_KEYWORDS", research.keywords)
        } catch (error) {
            const msg = await failStep(runId, "ORGANIC_KEYWORDS", error)
            failures.push(`keywords: ${msg}`)
        }
    })()

    // ─────────────────────────────────────────────────────────────────────────
    // PARALLEL TASK STREAM 6: Top Pages Snapshot
    // ─────────────────────────────────────────────────────────────────────────
    const streamTopPages = (async () => {
        if (!config.includeProviderResearch) return
        try {
            const step = await beginStep(runId, "TOP_PAGES")
            research.top_pages = step.completed ? step.result : await refreshTopPagesSnapshot({ ...scope, limit: 25 })
            if (!step.completed) await completeStep(runId, "TOP_PAGES", research.top_pages)
        } catch (error) {
            const msg = await failStep(runId, "TOP_PAGES", error)
            failures.push(`top pages: ${msg}`)
        }
    })()

    // ─────────────────────────────────────────────────────────────────────────
    // PARALLEL TASK STREAM 7: Competitors & Dependent Keyword Gap
    // ─────────────────────────────────────────────────────────────────────────
    const streamCompetitorsAndGap = (async () => {
        if (!config.includeProviderResearch) return
        try {
            const step = await beginStep(runId, "COMPETITORS")
            research.competitors = step.completed ? step.result : await refreshCompetitorsSnapshot({ ...scope, limit: 25 })
            if (!step.completed) await completeStep(runId, "COMPETITORS", research.competitors)

            // Keyword Gap immediately chains after competitor discovery
            const supplied = (input.competitor_domains ?? [])[0]
            const discovered = record(research.competitors).summary?.strongestCompetitor as string | undefined
            const competitorDomain = supplied ?? discovered
            if (competitorDomain) {
                const gapStep = await beginStep(runId, "KEYWORD_GAP")
                research.keyword_gap = gapStep.completed ? gapStep.result : await refreshKeywordGapSnapshot({ ...scope, competitorDomain, limit: 50 })
                if (!gapStep.completed) await completeStep(runId, "KEYWORD_GAP", research.keyword_gap)
            }
        } catch (error) {
            const msg = await failStep(runId, "COMPETITORS", error)
            failures.push(`competitors/gap: ${msg}`)
        }
    })()

    // ─────────────────────────────────────────────────────────────────────────
    // PARALLEL TASK STREAM 8: Backlinks Overview
    // ─────────────────────────────────────────────────────────────────────────
    const streamBacklinks = (async () => {
        if (!config.includeBacklinks) return
        try {
            const step = await beginStep(runId, "BACKLINKS")
            research.backlinks = step.completed ? step.result : await backlinksService.refreshOverview({ projectId: run.project_id, userId: actorUserId, target: run.project.brand_url, scope: "domain" })
            if (!step.completed) await completeStep(runId, "BACKLINKS", research.backlinks)
        } catch (error) {
            const msg = await failStep(runId, "BACKLINKS", error)
            failures.push(`backlinks: ${msg}`)
        }
    })()

    // AWAIT ALL INDEPENDENT PARALLEL STREAMS CONCURRENTLY
    await Promise.allSettled([
        streamWebsite,
        streamTechAudit,
        streamGsc,
        streamDomainOverview,
        streamOrganicKeywords,
        streamTopPages,
        streamCompetitorsAndGap,
        streamBacklinks,
    ])

    // ─────────────────────────────────────────────────────────────────────────
    // STAGE 2: Synthesize Evidence, 90-Day Plan & Actionable Recommendations
    // ─────────────────────────────────────────────────────────────────────────
    await updateRun(runId, { progress_percent: 80, current_step: "SYNTHESIZING_STRATEGY" })
    await buildRecommendations(runId, probe, research, technicalScore)

    const afterBalance = (await getCreditBalance(actorUserId)).remaining
    const spent = Math.max(0, beforeBalance - afterBalance)
    const summary = {
        tier: config.tier,
        crawled_pages: probe?.pages.length ?? 0,
        failed_urls: probe?.failed_urls.length ?? 0,
        technical_score: technicalScore ?? null,
        research_sources: Object.keys(research),
        failures,
        plan: {
            days_1_30: ["Resolve critical technical & indexability blockers", "Confirm high-intent keyword targets and competitors"],
            days_31_60: ["Optimize striking-distance pages (positions 8-30)", "Create intent-matched service landing pages", "Strengthen internal linking structure"],
            days_61_90: ["Expand authority with supporting cluster content", "Target competitor keyword gaps", "Re-run visibility and ranking audit"],
        },
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STAGE 3: AI Visibility Prompts (if enabled)
    // ─────────────────────────────────────────────────────────────────────────
    if (config.runAiVisibility && probe) {
        try {
            const step = await beginStep(runId, "AI_VISIBILITY")
            if (!step.completed) {
                await updateRun(runId, { current_step: "AI_VISIBILITY", progress_percent: 85, credits_spent: spent, summary, error_reason: failures.length ? failures.join("; ") : null })
                const visibility = await startAiVisibilityBaseline({
                    onboardingRunId: runId,
                    projectId: run.project_id,
                    actorUserId,
                    brandName: run.project.brand_name,
                    location: run.project.brand_location,
                    services: input.services ?? [],
                    maxPrompts: config.aiPromptCount,
                })
                await completeStep(runId, "AI_VISIBILITY", visibility)
                await updateRun(runId, { status: "WAITING_AI", visibility_run_id: visibility.visibilityRunId, current_step: "WAITING_AI", progress_percent: 90 })
                return
            }
        } catch (error) {
            failures.push(`AI visibility: ${await failStep(runId, "AI_VISIBILITY", error)}`)
        }
    }

    await updateRun(runId, {
        status: failures.length && !probe ? "FAILED" : failures.length ? "PARTIAL" : "COMPLETED",
        current_step: "COMPLETED",
        progress_percent: 100,
        credits_spent: spent,
        summary,
        error_reason: failures.length ? failures.join("; ") : null,
        completed_at: new Date(),
    })
}

export async function finalizeOnboardingVisibility(visibilityRunId: string) {
    const run = await prisma.seoOnboardingRun.findUnique({ where: { visibility_run_id: visibilityRunId }, include: { project: true } })
    if (!run || run.status !== "WAITING_AI") return
    const step = await beginStep(run.id, "AI_VISIBILITY_FINALIZED")
    if (step.completed) return
    try {
        const visibility = await summarizeAiVisibility(visibilityRunId)
        await finding(run.id, {
            category: "AI_VISIBILITY",
            title: "AI visibility baseline completed",
            summary: visibility.visibility_percent == null
                ? "No successful AI visibility checks were returned."
                : `Brand mention rate: ${visibility.visibility_percent}% across ${visibility.successful_jobs} successful checks.`,
            severity: visibility.visibility_percent == null || visibility.visibility_percent < 20 ? "HIGH" : "INFO",
            evidence: visibility,
        })
        await recommendation(run.id, {
            title: "Target AI visibility gaps with authoritative content",
            description: "Review buyer prompts where your brand was not cited. Create clear, evidence-backed answers on your website to get cited by ChatGPT and Perplexity.",
            category: "AI_VISIBILITY",
            priority: visibility.visibility_percent != null && visibility.visibility_percent < 20 ? "HIGH" : "MEDIUM",
            impact_score: 80, effort_score: 55, confidence_score: visibility.successful_jobs ? 85 : 35,
            recommended_action: "improve_ai_visibility",
            success_metric: "Increase brand mention rate in AI search responses",
            evidence: visibility,
        })
        await completeStep(run.id, "AI_VISIBILITY_FINALIZED", visibility)
        await archiveOnboardingPrompts(run.id)
        const balance = await getCreditBalance(run.requested_by_user_id)
        const baseSummary = record(run.summary)
        await updateRun(run.id, {
            status: run.error_reason ? "PARTIAL" : "COMPLETED",
            current_step: "COMPLETED",
            progress_percent: 100,
            summary: { ...baseSummary, ai_visibility: visibility },
            credits_spent: Math.max(run.credits_spent, 0),
            cost_breakdown: { ...(record(run.cost_breakdown)), balance_after_ai_visibility: balance.remaining },
            completed_at: new Date(),
        })
    } catch (error) {
        const message = await failStep(run.id, "AI_VISIBILITY_FINALIZED", error)
        await updateRun(run.id, {
            status: "PARTIAL",
            current_step: "COMPLETED",
            progress_percent: 100,
            error_reason: [run.error_reason, `AI visibility finalization: ${message}`].filter(Boolean).join("; "),
            completed_at: new Date(),
        })
    }
}

export async function startOnboarding(input: { projectId: string; actorUserId: string; onboarding: OnboardingInput }) {
    const project = await assertProjectAccess(input.projectId, input.actorUserId)
    const existing = await prisma.seoOnboardingRun.findFirst({
        where: { project_id: project.id, status: { in: ["QUEUED", "RUNNING", "WAITING_AI"] } },
        select: { id: true, status: true },
    })
    if (existing) {
        throw Object.assign(new Error("A strategy audit is already running for this project"), { status: 409 })
    }

    const config = resolveTierConfig(input.onboarding)
    const balance = await getCreditBalance(input.actorUserId)
    if (balance.remaining < config.maxCredits) {
        throw Object.assign(
            new Error(`This ${config.tier} strategy audit requires a budget of ${config.maxCredits} credits. Your current balance is ${balance.remaining} credits.`),
            { status: 402 }
        )
    }

    const run = await prisma.seoOnboardingRun.create({
        data: {
            id: crypto.randomUUID(),
            project_id: project.id,
            client_user_id: project.user_id,
            requested_by_user_id: input.actorUserId,
            max_credits: config.maxCredits,
            input: inputJson(input.onboarding, config) as Prisma.InputJsonValue,
        },
    })

    setImmediate(() => executeOnboarding(run.id, input.actorUserId).catch(async error => {
        await updateRun(run.id, {
            status: "FAILED",
            current_step: "FAILED",
            error_reason: error instanceof Error ? error.message : "Strategy audit failed",
            completed_at: new Date(),
        }).catch(console.error)
    }))

    return {
        run_id: run.id,
        status: run.status,
        tier: config.tier,
        estimated_max_credits: config.maxCredits,
    }
}

export async function retryOnboarding(runId: string, actorUserId: string) {
    const run = await prisma.seoOnboardingRun.findUnique({ where: { id: runId } })
    if (!run) throw Object.assign(new Error("Strategy audit run not found"), { status: 404 })
    await assertProjectAccess(run.project_id, actorUserId)
    if (run.status === "WAITING_AI") return { run_id: run.id, status: run.status }
    if (run.status === "COMPLETED") throw Object.assign(new Error("Completed runs cannot be retried"), { status: 409 })
    await updateRun(run.id, { status: "QUEUED", current_step: "QUEUED", error_reason: null })
    setImmediate(() => executeOnboarding(run.id, actorUserId).catch(console.error))
    return { run_id: run.id, status: "QUEUED" }
}

export async function getOnboardingRun(runId: string, actorUserId: string) {
    const run = await prisma.seoOnboardingRun.findUnique({
        where: { id: runId },
        include: {
            project: true,
            steps: { orderBy: { created_at: "asc" } },
            findings: { orderBy: { created_at: "asc" } },
            recommendations: { orderBy: [{ priority: "asc" }, { created_at: "asc" }] },
        },
    })
    if (!run) throw Object.assign(new Error("Strategy audit run not found"), { status: 404 })
    await assertProjectAccess(run.project_id, actorUserId)
    return run
}

export async function getLatestOnboardingRun(projectId: string, actorUserId: string) {
    await assertProjectAccess(projectId, actorUserId)
    const run = await prisma.seoOnboardingRun.findFirst({
        where: { project_id: projectId },
        orderBy: { created_at: "desc" },
        include: {
            project: true,
            steps: { orderBy: { created_at: "asc" } },
            findings: { orderBy: { created_at: "asc" } },
            recommendations: { orderBy: [{ priority: "asc" }, { created_at: "asc" }] },
        },
    })
    return run
}

export async function approveOnboardingRecommendation(recommendationId: string, actorUserId: string) {
    const item = await prisma.seoOnboardingRecommendation.findUnique({
        where: { id: recommendationId },
        include: { run: { include: { project: true } } },
    })
    if (!item) throw Object.assign(new Error("Recommendation not found"), { status: 404 })
    await assertProjectAccess(item.run.project_id, actorUserId)
    if (item.approval_status === "APPROVED" && item.action_queue_id) return item
    if (item.approval_status === "REJECTED") throw Object.assign(new Error("Rejected recommendations cannot be approved"), { status: 409 })

    const action = await prisma.actionQueueItem.create({
        data: {
            project_id: item.run.project_id,
            user_id: item.run.client_user_id,
            title: item.title,
            description: item.description,
            category: item.category,
            priority: item.priority,
            impact_score: item.impact_score,
            effort_score: item.effort_score,
            confidence_score: item.confidence_score,
            recommended_action: item.recommended_action,
            success_metric: item.success_metric,
            evidence: (item.evidence ?? {}) as Prisma.InputJsonValue,
            source_type: "SEO_ONBOARDING",
            source_ref_id: item.id,
        },
    })
    return prisma.seoOnboardingRecommendation.update({
        where: { id: item.id },
        data: { approval_status: "APPROVED", action_queue_id: action.id },
    })
}

export async function rejectOnboardingRecommendation(recommendationId: string, actorUserId: string) {
    const item = await prisma.seoOnboardingRecommendation.findUnique({
        where: { id: recommendationId },
        include: { run: true },
    })
    if (!item) throw Object.assign(new Error("Recommendation not found"), { status: 404 })
    await assertProjectAccess(item.run.project_id, actorUserId)
    if (item.approval_status === "APPROVED") throw Object.assign(new Error("Approved recommendations cannot be rejected"), { status: 409 })
    return prisma.seoOnboardingRecommendation.update({
        where: { id: item.id },
        data: { approval_status: "REJECTED" },
    })
}
