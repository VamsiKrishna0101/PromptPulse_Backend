import { researchBrand } from "../llm/parallel_service";
import { generateBrandPrompts, summarizeBrandResearch } from "../llm/gemini_service";
import prisma from "../../lib/prisma";
import { crawlBrandWebsite } from "./brand_crawler_service";
import type { BrandResearchInput, PromptInput, CreateProjectInput } from "./onboarding_types";
import { getPromptLimitForPlan } from "./plan_limits";

export async function researchbrand(input: BrandResearchInput) {
    const { brand_url, brand_name } = input

    let crawl
    try {
        crawl = await crawlBrandWebsite(brand_name, brand_url)
    } catch (crawlerError) {
        const fallback = await researchBrand(brand_name, brand_url)
        return {
            ...fallback,
            research_source: 'parallel_fallback',
            crawler_error: crawlerError instanceof Error ? crawlerError.message : 'Website crawler failed',
        }
    }

    try {
        const data = await summarizeBrandResearch(brand_name, crawl.brand_url, crawl)

        return {
            brand_name,
            brand_url: crawl.brand_url,
            research_source: crawl.source,
            pages_crawled: crawl.pages_crawled,
            important_links: crawl.important_links,
            social_links: crawl.social_links,
            crawler_notes: crawl.crawler_notes,
            data,
        }
    } catch (summaryError) {
        const fallback = await researchBrand(brand_name, brand_url)
        return {
            ...fallback,
            research_source: 'parallel_fallback',
            crawler_source: crawl.source,
            pages_crawled: crawl.pages_crawled,
            important_links: crawl.important_links,
            social_links: crawl.social_links,
            crawler_notes: crawl.crawler_notes,
            summary_error: summaryError instanceof Error ? summaryError.message : 'Brand research summary failed',
        }
    }
}

export async function promptgeneration(input: PromptInput) {
    const { brand_name, brand_url, brand_data } = input
    const result = await generateBrandPrompts(brand_name, brand_url, brand_data)
    return result
}

export async function createProject(input: CreateProjectInput) {
    const { user_id, brand_name, brand_url, brand_location, competitors, prompts } = input

    try {
        const user = await prisma.user.findUnique({
            where: { id: user_id },
            select: { plan: true },
        })

        if (!user) {
            throw new Error('User not found')
        }

        const promptLimit = getPromptLimitForPlan(user.plan)
        if (prompts.length > promptLimit) {
            throw new Error(`Your ${user.plan.toLowerCase()} plan can track up to ${promptLimit} prompts.`)
        }

        const project = await prisma.project.create({
            data: {
                user_id,
                brand_name,
                brand_url,
                brand_location,
                competitors: {
                    create: competitors.map(c => ({ name: c }))
                },
                prompts: {
                    create: prompts.map(p => ({
                        text: p.text,
                        topic: p.topic,
                        type: p.type
                    }))
                }
            }
        })

        return project
    } catch (error) {
        throw error
    }
}
