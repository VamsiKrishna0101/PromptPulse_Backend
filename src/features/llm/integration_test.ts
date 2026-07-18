import 'dotenv/config'
import prisma from '../../lib/prisma'
import { runPrompt } from '../dashboard/dashboard_service'
import { getDashboardData } from '../dashboard/dashboard_service'
import { getDiscoveredBrands, addCompetitor, getTrackedCompetitors } from '../brands/brand_service'
import { getTopSources } from '../sources/sources_service'

const RAW_RESPONSE = `Here are the best CRM tools for Indian startups, curated by cost, ease of use, and local integration capabilities like WhatsApp and Tally.
Groweon CRM

Top CRM Recommendations

Zoho CRM
₹1,300.00
4.7
(49)

Zoho CRM is a highly scalable, homegrown platform that balances advanced AI automation with native regional language and Tally accounting integrations.

Best For: Overall performance and value-conscious startups.
Kylas CRM

Key Features: Lead management, AI insights (Zia), and custom sales workflows.
DigiSME

Starting Price: ~₹800/user/month.
Groweon CRM

HubSpot CRM
HubSpot CRM offers an exceptional free-forever plan that seamlessly bridges the gap between early-stage marketing pipelines and sales tracking.

Best For: Early-stage startups focused on inbound content and marketing alignment.

Key Features: Email tracking, contact pipelines, and generous startup discounts (up to 90% off).
Kylas CRM

Starting Price: Free tier available; paid plans start around ₹1,660/user/month.
Kylas CRM

Kylas Sales CRM
Kylas Sales CRM removes per-user licensing friction by offering an enterprise-grade platform with flat monthly pricing for unlimited users.

Best For: Rapidly growing teams wanting predictable software costs.
Kylas CRM

Key Features: Native WhatsApp Business API integration, lead routing, and built-in pipeline reports.
Kylas CRM

Starting Price: Flat ₹12,999/month for unlimited users.
Kylas CRM

Quick Comparison
CRM Tool    Best For    Standout Advantage
Zoho CRM    Balanced Scaling    Strongest local integration ecosystem (Tally/Zoho Books)
HubSpot    Inbound Marketing    Robust free tier & massive startup discount program
Kylas    High-Velocity Teams    No per-seat fees; unlimited team members

If you want a recommendation, Zoho CRM is usually the safest long-term bet for Indian businesses due to its massive local ecosystem. If your team relies heavily on WhatsApp outreach or field sales, local tools like Kylas or LeadSquared are worth looking into.

Source: https://google.com/search?q=Zoho+CRM&gl=IN&hl=en`

console.log('=== FULL DB INTEGRATION TEST ===\n')

console.log('Step 1: Setting up test user, project, prompt and run...')

const user = await prisma.user.upsert({
    where: { email: 'test@zoho-demo.com' },
    update: {},
    create: {
        email: 'test@zoho-demo.com',
        password: 'hashed_password_here',
        account_type: 'SINGLE',
        is_verified: true
    }
})

const project = await prisma.project.upsert({
    where: { brand_name: 'Zoho CRM' },
    update: {},
    create: {
        brand_name: 'Zoho CRM',
        brand_url: 'zoho.com/crm',
        brand_location: 'India',
        user_id: user.id
    }
})

let prompt = await prisma.prompt.findFirst({
    where: { project_id: project.id, text: { contains: 'CRM tools for Indian startups' } }
})

if (!prompt) {
    prompt = await prisma.prompt.create({
        data: {
            project_id: project.id,
            text: 'What are the best CRM tools for Indian startups?',
            topic: 'CRM Software India',
            type: 'DISCOVERY'
        }
    })
}

const run = await prisma.run.create({
    data: { project_id: project.id }
})

console.log(`User ID:    ${user.id}`)
console.log(`Project ID: ${project.id}`)
console.log(`Prompt ID:  ${prompt.id}`)
console.log(`Run ID:     ${run.id}`)

console.log('\nStep 2: Running prompt analysis and saving to DB...')
const chat = await runPrompt({
    prompt_id: prompt.id,
    run_id: run.id,
    raw_response: RAW_RESPONSE,
    ai_model: 'gemini-ui'
})

console.log(`Chat saved! ID: ${chat.id}`)
console.log(`Brand mentioned: ${chat.brand_mentioned} | Position: ${chat.brand_position ?? 'N/A'} | Sentiment: ${chat.sentiment_score ?? 'N/A'}`)
console.log(`BrandMentions saved: ${chat.brand_mentions.length}`)
console.log(`Sources saved:       ${chat.sources.length}`)

console.log('\nStep 3: getDashboardData (your brand stats)...')
const dashboard = await getDashboardData({ project_id: project.id })
console.log('Brand stats:', JSON.stringify(dashboard?.brand, null, 2))

console.log('\nStep 4: getDiscoveredBrands (all AI-discovered competitors)...')
const discovered = await getDiscoveredBrands(project.id)
discovered.forEach((b, i) => {
    console.log(`[${i + 1}] ${b.brand_name.padEnd(25)} | Visibility: ${b.visibility.toFixed(1)}% | Avg Position: ${b.avg_position?.toFixed(1) ?? 'N/A'} | Avg Sentiment: ${b.avg_sentiment?.toFixed(1) ?? 'N/A'}`)
})

console.log('\nStep 5: addCompetitor (user tracks Kylas CRM)...')
const competitor = await addCompetitor({ project_id: project.id, name: 'Kylas CRM', user_id: user.id })
console.log(`Tracked: ${competitor.name} (ID: ${competitor.id})`)

console.log('\nStep 6: getTrackedCompetitors (user\'s saved list with stats)...')
const tracked = await getTrackedCompetitors(project.id)
tracked.forEach((c, i) => {
    console.log(`[${i + 1}] ${c.name.padEnd(25)} | Visibility: ${c.visibility.toFixed(1)}% | Avg Position: ${c.avg_position?.toFixed(1) ?? 'N/A'} | Avg Sentiment: ${c.avg_sentiment?.toFixed(1) ?? 'N/A'}`)
})

console.log('\nStep 7: getTopSources...')
const sources = await getTopSources(project.id)
sources.forEach((s, i) => {
    console.log(`[${i + 1}] ${s.domain.padEnd(25)} | Type: ${s.source_type.padEnd(12)} | Used: ${s.used_percentage.toFixed(1)}% | Avg Citations: ${s.avg_citations.toFixed(1)}`)
})

console.log('\n=== TEST COMPLETE ===')
await prisma.$disconnect()
