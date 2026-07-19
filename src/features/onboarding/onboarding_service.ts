import { researchBrand } from "../llm/parallel_service";
import { generateBrandPrompts, summarizeBrandResearch } from "../llm/gemini_service";
import prisma from "../../lib/prisma";
import { crawlBrandWebsite } from "./brand_crawler_service";
import type { BrandResearchInput, PromptInput, CreateProjectInput } from "./onboarding_types";
import { assertCanAddCompetitors, assertCanCreateProjectWithPrompts } from "../subscription/subscription_service";
import { getGeoCountryByName } from "../geo/countries";

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
            select: { id: true },
        })

        if (!user) {
            throw new Error('User not found')
        }

        const normalizedPrompts = [...new Map(prompts.map(prompt => {
            const text = prompt.text.trim().replace(/\s+/g, ' ')
            const topic = prompt.topic.trim().replace(/\s+/g, ' ') || 'Imported prompts'
            return [text.toLowerCase(), {
                text,
                topic,
                type: prompt.type.trim().replace(/\s+/g, '_') || 'buyer_question',
                selected: Boolean(prompt.selected),
                source: prompt.source === 'CUSTOMER' ? 'CUSTOMER' as const : 'GENERATED' as const,
            }]
        })).values()].filter(prompt => prompt.text.length >= 8 && prompt.text.length <= 500)

        const activePromptCount = normalizedPrompts.filter(prompt => prompt.selected).length
        if (activePromptCount === 0) {
            throw new Error('Select at least one prompt for your first visibility run')
        }

        await assertCanCreateProjectWithPrompts(user_id, activePromptCount)
        await assertCanAddCompetitors(user_id, competitors.length)

        const country = getGeoCountryByName(brand_location)
        if (!country) {
            throw new Error('Please select a supported primary market')
        }

        const project = await prisma.$transaction(async transaction => {
            const createdProject = await transaction.project.create({
                data: {
                    user_id,
                    brand_name,
                    brand_url,
                    brand_location: country.name,
                    competitors: {
                        create: competitors.map(c => ({ name: c }))
                    },
                },
            })

            const topicNames = [...new Set(normalizedPrompts.map(prompt => prompt.topic))]
            if (topicNames.length) {
                await transaction.topic.createMany({
                    data: topicNames.map(name => ({ name, project_id: createdProject.id })),
                    skipDuplicates: true,
                })
            }

            await transaction.prompt.createMany({
                data: normalizedPrompts.map(prompt => ({
                    project_id: createdProject.id,
                    text: prompt.text,
                    topic: prompt.topic,
                    type: prompt.type,
                    status: prompt.selected ? 'ACTIVE' : 'SUGGESTED',
                    is_active: prompt.selected,
                    source: prompt.source,
                    tags: prompt.selected ? ['onboarding:selected'] : ['onboarding:unused'],
                })),
            })

            return createdProject
        })

        return project
    } catch (error) {
        throw error
    }
}
