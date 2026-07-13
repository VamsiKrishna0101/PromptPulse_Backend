import Parallel from 'parallel-web'

export async function researchBrand(brand_name: string, brand_url: string) {
    if (!process.env.PARALLEL_API_KEY) {
        throw new Error('PARALLEL_API_KEY is missing; Parallel fallback cannot run.')
    }

    const client = new Parallel({ apiKey: process.env.PARALLEL_API_KEY })

    const taskRun = await client.taskRun.create({
        input: { brand_name, brand_url },
        processor: 'base',
        task_spec: {
            input_schema: {
                type: 'json',
                json_schema: {
                    type: 'object',
                    properties: {
                        brand_name: { type: 'string', description: 'The name of the brand to research' },
                        brand_url: { type: 'string', description: 'The official website URL of the brand' },
                    },
                    required: ['brand_name', 'brand_url'],
                },
            },
            output_schema: {
                type: 'json',
                json_schema: {
                    type: 'object',
                    properties: {
                        tagline: { type: 'string', description: 'Official tagline or slogan of the brand' },
                        description: { type: 'string', description: 'A 2-4 sentence summary of what the brand does' },
                        industry: { type: 'string', description: 'The primary industry the brand operates in' },
                        founded: { type: 'string', description: 'Founding year of the brand if publicly known' },
                        headquarters: { type: 'string', description: 'City and country of the brand headquarters' },
                        employee_count: {
                            type: 'string',
                            enum: ['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5001-10000', '10001+'],
                            description: 'Approximate number of employees',
                        },
                        business_model: { type: 'string', description: 'How the brand makes money (e.g. SaaS, D2C, marketplace)' },
                        target_audience: { type: 'string', description: 'Who the brand primarily targets or sells to' },
                        key_products_services: { type: 'string', description: 'Main products or services offered by the brand' },
                        pricing_model: { type: 'string', description: 'How the brand prices its offerings if publicly visible' },
                        competitors: { type: 'string', description: 'Top 3-5 known competitors of the brand' },
                        recent_news: { type: 'string', description: 'Any notable recent news, launches or updates' },
                        social_presence: { type: 'string', description: 'Key social media channels and approximate follower counts' },
                        tone_and_voice: { type: 'string', description: 'Brand tone: professional, playful, bold, minimal, etc.' },
                        unique_value_proposition: { type: 'string', description: 'What makes this brand different from competitors' },
                    },
                    required: [
                        'description', 'industry', 'business_model',
                        'target_audience', 'key_products_services',
                        'competitors', 'tone_and_voice', 'unique_value_proposition',
                    ],
                    additionalProperties: false,
                },
            },
        },
    })

    let runResult
    for (let i = 0; i < 144; i++) {
        try {
            runResult = await client.taskRun.result(taskRun.run_id, { timeout: 25 })
            break
        } catch {
            if (i === 143) throw new Error('Brand research timed out')
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    }

    const content = (runResult as { output: { content: unknown } }).output.content

    return {
        brand_name,
        brand_url,
        run_id: taskRun.run_id,
        data: content,
    }
}
