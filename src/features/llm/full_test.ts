import 'dotenv/config'
import { researchbrand } from '../onboarding/onboarding_service'
import { promptgeneration } from '../onboarding/onboarding_service'

const BRAND_NAME = 'Refractone'
const BRAND_URL = 'https://refractone.com/'

console.log('Step 1: Researching brand with Parallel AI...')
const brandResult = await researchbrand({ brand_name: BRAND_NAME, brand_url: BRAND_URL })

console.log('\n--- Brand Research Result ---')
console.log(JSON.stringify(brandResult, null, 2))

const brandData = (brandResult as { data: Record<string, unknown> }).data

console.log('\nStep 2: Generating enterprise prompts with Gemini...')
const promptResult = await promptgeneration({
    brand_name: BRAND_NAME,
    brand_url: BRAND_URL,
    brand_data: brandData,
})

console.log('\n--- Generated Prompts ---')
promptResult.prompts.forEach((p, i) => {
    console.log(`\n[${i + 1}] Topic: ${p.topic}`)
    console.log(`    Prompt: ${p.text}`)
})
