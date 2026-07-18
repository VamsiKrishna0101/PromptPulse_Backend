import { Prisma } from "@prisma/client"
import prisma from "../../lib/prisma"
import { getBrandPreference } from "../brand_preferences/brand_preferences_service"
import type { AgentsRedditScanResponse } from "./reddit_intelligence_types"

export async function listRedditIntelligence(projectId: string, userId: string) {
    const [latestRun, runs, posts, citedThreads, brandPreference] = await Promise.all([
        prisma.redditIntelligenceRun.findFirst({
            where: { project_id: projectId, user_id: userId },
            orderBy: { created_at: "desc" },
            include: {
                posts: {
                    orderBy: [{ importance_score: "desc" }, { num_comments: "desc" }],
                    take: 20,
                },
            },
        }),
        prisma.redditIntelligenceRun.findMany({
            where: { project_id: projectId, user_id: userId },
            orderBy: { created_at: "desc" },
            take: 8,
            include: {
                posts: {
                    orderBy: [{ importance_score: "desc" }, { num_comments: "desc" }],
                    take: 30,
                },
            },
        }),
        prisma.redditPost.findMany({
            where: { project_id: projectId, user_id: userId },
            orderBy: [{ importance_score: "desc" }, { num_comments: "desc" }],
            take: 50,
        }),
        loadAiCitedRedditThreads(projectId),
        getBrandPreference(projectId, userId),
    ])

    return {
        latest_run: latestRun,
        runs,
        posts,
        cited_threads: citedThreads,
        brand_preference: brandPreference,
        summary: buildStoredSummary(latestRun, posts, citedThreads),
    }
}

export async function createPendingRun(input: {
    projectId: string
    userId: string
    mode: string
    credits: number
    postLimit: number
}) {
    return prisma.redditIntelligenceRun.create({
        data: {
            project_id: input.projectId,
            user_id: input.userId,
            mode: input.mode,
            status: "RUNNING",
            credits_spent: input.credits,
            post_limit: input.postLimit,
        },
    })
}

export async function persistRedditScanResult(input: {
    runId: string
    projectId: string
    userId: string
    result: AgentsRedditScanResponse
}) {
    const result = input.result
    return prisma.$transaction(async tx => {
        const run = await tx.redditIntelligenceRun.update({
            where: { id: input.runId },
            data: {
                status: result.status,
                keyword_count: result.keywords.length,
                keywords: result.keywords as Prisma.InputJsonValue,
                summary: result.summary as Prisma.InputJsonValue,
                themes: result.themes as Prisma.InputJsonValue,
                actions: result.actions as Prisma.InputJsonValue,
                raw_result: {
                    raw_post_count: result.raw_post_count,
                    unique_post_count: result.unique_post_count,
                    maybe_post_count: result.maybe_post_count ?? 0,
                    rejected_post_count: result.rejected_post_count ?? 0,
                    errors: result.errors,
                } as Prisma.InputJsonValue,
                error_reason: result.errors?.join("; ") || null,
                completed_at: new Date(),
            },
        })

        for (const post of result.posts) {
            await tx.redditPost.upsert({
                where: {
                    project_id_url: {
                        project_id: input.projectId,
                        url: post.url,
                    },
                },
                create: {
                    run_id: input.runId,
                    project_id: input.projectId,
                    user_id: input.userId,
                    post_id: post.post_id ?? null,
                    url: post.url,
                    subreddit: post.subreddit ?? null,
                    title: post.title,
                    description: post.description ?? null,
                    author: post.author ?? null,
                    keyword: post.keyword ?? null,
                    num_comments: post.num_comments ?? 0,
                    num_upvotes: post.num_upvotes ?? 0,
                    date_posted: post.date_posted ? new Date(post.date_posted) : null,
                    sentiment: post.sentiment ?? null,
                    intent: post.intent ?? null,
                    importance_score: post.importance_score ?? 0,
                    mentioned_brands: (post.mentioned_brands ?? []) as Prisma.InputJsonValue,
                    mentioned_competitors: (post.mentioned_competitors ?? []) as Prisma.InputJsonValue,
                    raw_json: buildPostRawJson(post) as Prisma.InputJsonValue,
                },
                update: {
                    run_id: input.runId,
                    post_id: post.post_id ?? null,
                    subreddit: post.subreddit ?? null,
                    title: post.title,
                    description: post.description ?? null,
                    author: post.author ?? null,
                    keyword: post.keyword ?? null,
                    num_comments: post.num_comments ?? 0,
                    num_upvotes: post.num_upvotes ?? 0,
                    date_posted: post.date_posted ? new Date(post.date_posted) : null,
                    sentiment: post.sentiment ?? null,
                    intent: post.intent ?? null,
                    importance_score: post.importance_score ?? 0,
                    mentioned_brands: (post.mentioned_brands ?? []) as Prisma.InputJsonValue,
                    mentioned_competitors: (post.mentioned_competitors ?? []) as Prisma.InputJsonValue,
                    raw_json: buildPostRawJson(post) as Prisma.InputJsonValue,
                },
            })
        }

        return run
    })
}

export async function markRedditRunRefunded(runId: string, errorReason: string) {
    return prisma.redditIntelligenceRun.update({
        where: { id: runId },
        data: {
            status: "FAILED",
            credits_spent: 0,
            error_reason: errorReason.slice(0, 1000),
            completed_at: new Date(),
        },
    })
}

export async function markRedditRunFailed(runId: string, errorReason: string) {
    return prisma.redditIntelligenceRun.update({
        where: { id: runId },
        data: {
            status: "FAILED",
            error_reason: errorReason.slice(0, 1000),
            completed_at: new Date(),
        },
    })
}

async function loadAiCitedRedditThreads(projectId: string) {
    const sources = await prisma.source.findMany({
        where: {
            domain: { contains: "reddit", mode: "insensitive" },
            chat: {
                prompt: { project_id: projectId },
            },
        },
        orderBy: { created_at: "desc" },
        take: 40,
        select: {
            id: true,
            url: true,
            domain: true,
            title: true,
            snippet: true,
            subreddit: true,
            chat: {
                select: {
                    id: true,
                    ai_model: true,
                    brand_mentioned: true,
                    sentiment_score: true,
                    created_at: true,
                    prompt: {
                        select: {
                            id: true,
                            text: true,
                            topic: true,
                        },
                    },
                },
            },
        },
    })

    return sources
}

function buildStoredSummary(latestRun: unknown, posts: Array<{ sentiment: string | null; subreddit: string | null }>, citedThreads: unknown[]) {
    const subreddits = Array.from(new Set(posts.map(post => post.subreddit).filter(Boolean))).slice(0, 5)
    return {
        latest_run: latestRun,
        stored_posts: posts.length,
        ai_cited_reddit_threads: citedThreads.length,
        negative_or_skeptical_posts: posts.filter(post => post.sentiment === "negative" || post.sentiment === "skeptical").length,
        top_subreddits: subreddits,
    }
}

function buildPostRawJson(post: AgentsRedditScanResponse["posts"][number]) {
    return {
        ...(post.raw_json ?? {}),
        relevance_score: post.relevance_score ?? post.raw_json?.relevance_score ?? 0,
        relevance_bucket: post.relevance_bucket ?? post.raw_json?.relevance_bucket ?? "maybe",
        relevance_reasons: post.relevance_reasons ?? post.raw_json?.relevance_reasons ?? [],
    }
}
