import "dotenv/config"
import prisma from "../lib/prisma"

const DEMO_TAG = "DEMO_15D_SEED"
const TARGET_EMAIL = process.env.DEMO_SEED_EMAIL ?? "vamsi.krishna@refractconsulting.com"

const engines = ["CHATGPT", "GEMINI", "PERPLEXITY"] as const

const demoPrompts = [
  {
    text: "[DEMO 15D] Best AI visibility tools for B2B marketing teams in India",
    topic: "AI visibility tools",
    type: "category_discovery",
  },
  {
    text: "[DEMO 15D] Which platforms help Indian B2B SaaS companies track brand mentions in AI answers?",
    topic: "brand monitoring",
    type: "competitor_comparison",
  },
  {
    text: "[DEMO 15D] Top tools for improving GEO and LLM search visibility for startups",
    topic: "GEO optimization",
    type: "solution_research",
  },
]

const competitors = ["Peec AI", "PromptWatch", "PromptMonitor", "Profound", "AthenaHQ"]

const sourcePool = [
  {
    domain: "g2.com",
    url: "https://www.g2.com/categories/ai-search-visibility",
    title: "Best AI Search Visibility Software",
    source_type: "EDITORIAL",
    url_type: "LISTICLE",
  },
  {
    domain: "reddit.com",
    url: "https://www.reddit.com/r/SEO/comments/demo_ai_visibility_tools/",
    title: "AI visibility tools for SaaS brands",
    source_type: "UGC",
    url_type: "DISCUSSION",
    platform: "reddit",
    subreddit: "r/SEO",
  },
  {
    domain: "linkedin.com",
    url: "https://www.linkedin.com/pulse/geo-monitoring-india-b2b-saas-demo",
    title: "GEO monitoring for Indian B2B SaaS",
    source_type: "SOCIAL",
    url_type: "SOCIAL_POST",
    platform: "linkedin",
  },
  {
    domain: "peec.ai",
    url: "https://peec.ai/",
    title: "Peec AI",
    source_type: "COMPETITOR",
    url_type: "HOMEPAGE",
  },
  {
    domain: "promptwatch.io",
    url: "https://promptwatch.io/",
    title: "PromptWatch",
    source_type: "COMPETITOR",
    url_type: "HOMEPAGE",
  },
  {
    domain: "refractconsulting.com",
    url: "https://refractconsulting.com/",
    title: "Refract Consulting",
    source_type: "YOU",
    url_type: "HOMEPAGE",
  },
  {
    domain: "searchengineland.com",
    url: "https://searchengineland.com/demo-generative-engine-optimization",
    title: "Generative engine optimization trends",
    source_type: "EDITORIAL",
    url_type: "ARTICLE",
  },
  {
    domain: "hubspot.com",
    url: "https://blog.hubspot.com/marketing/demo-ai-search-brand-visibility",
    title: "AI search brand visibility guide",
    source_type: "CORPORATE",
    url_type: "ARTICLE",
  },
]

function dayAtOffset(daysAgo: number) {
  const date = new Date()
  date.setHours(9, 30, 0, 0)
  date.setDate(date.getDate() - daysAgo)
  return date
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function pick<T>(items: T[], index: number, count: number) {
  return Array.from({ length: count }, (_, offset) => items[(index + offset) % items.length])
}

function ownMentioned(dayIndex: number, promptIndex: number, engineIndex: number) {
  const score = (dayIndex * 2 + promptIndex * 3 + engineIndex) % 10
  return score >= 3
}

function competitorMentions(dayIndex: number, promptIndex: number, engineIndex: number) {
  const first = competitors[(dayIndex + promptIndex + engineIndex) % competitors.length]
  const second = competitors[(dayIndex + promptIndex + engineIndex + 2) % competitors.length]
  const third = competitors[(dayIndex + promptIndex + engineIndex + 4) % competitors.length]
  return (dayIndex + engineIndex) % 3 === 0 ? [first, second, third] : [first, second]
}

function responseText(projectBrand: string, prompt: string, engine: string, mentionedOwnBrand: boolean, mentions: string[]) {
  const brandSentence = mentionedOwnBrand
    ? `${projectBrand} is also visible for India-focused teams when the use case is GEO strategy, prompt monitoring, and implementation support.`
    : `${projectBrand} is not consistently surfaced yet, which creates a visibility gap against specialist AI visibility platforms.`

  return [
    `Demo response for: ${prompt}`,
    `${engine} recommends comparing ${mentions.join(", ")} for AI visibility workflows across prompts, citations, and brand sentiment.`,
    brandSentence,
    "The strongest sources are category pages, community discussions, LinkedIn posts, and competitor homepages.",
  ].join("\n\n")
}

async function deletePreviousDemoRuns(projectId: string) {
  const runs = await prisma.run.findMany({
    where: { project_id: projectId, error_reason: DEMO_TAG },
    select: { id: true },
  })
  const runIds = runs.map((run) => run.id)
  if (!runIds.length) return

  const chats = await prisma.chat.findMany({
    where: { run_id: { in: runIds } },
    select: { id: true },
  })
  const chatIds = chats.map((chat) => chat.id)

  await prisma.source.deleteMany({ where: { chat_id: { in: chatIds } } })
  await prisma.brandMention.deleteMany({ where: { chat_id: { in: chatIds } } })
  await prisma.scrapeJob.deleteMany({ where: { run_id: { in: runIds } } })
  await prisma.chat.deleteMany({ where: { id: { in: chatIds } } })
  await prisma.run.deleteMany({ where: { id: { in: runIds } } })
}

async function ensureDemoPrompts(projectId: string) {
  const prompts = []
  for (const prompt of demoPrompts) {
    const existing = await prisma.prompt.findFirst({
      where: { project_id: projectId, text: prompt.text },
    })

    if (existing) {
      prompts.push(await prisma.prompt.update({
        where: { id: existing.id },
        data: {
          topic: prompt.topic,
          type: prompt.type,
          is_active: true,
          status: "ACTIVE",
          source: "GENERATED",
          priority_score: 0.86,
          volume_score: 0.74,
        },
      }))
    } else {
      prompts.push(await prisma.prompt.create({
        data: {
          project_id: projectId,
          text: prompt.text,
          topic: prompt.topic,
          type: prompt.type,
          is_active: true,
          status: "ACTIVE",
          source: "GENERATED",
          priority_score: 0.86,
          volume_score: 0.74,
        },
      }))
    }
  }
  return prompts
}

async function ensureCompetitors(projectId: string) {
  for (const name of competitors.slice(0, 3)) {
    const existing = await prisma.competitor.findFirst({ where: { project_id: projectId, name } })
    if (!existing) {
      await prisma.competitor.create({ data: { project_id: projectId, name } })
    }
  }
}

async function ensureSourceContent() {
  for (const source of sourcePool) {
    await prisma.sourceUrlContent.upsert({
      where: { url: source.url },
      update: {
        domain: source.domain,
        title: source.title,
        snippet: `Demo source used for 15-day AI visibility history: ${source.title}.`,
        source_type: source.source_type as any,
        url_type: source.url_type as any,
        platform: "platform" in source ? source.platform : null,
        subreddit: "subreddit" in source ? source.subreddit : null,
        mentioned_brands: [source.title, ...competitors],
        fetch_status: "SUCCESS",
        content_updated_at: new Date(),
      },
      create: {
        url: source.url,
        domain: source.domain,
        title: source.title,
        content: `Demo content for ${source.title}`,
        snippet: `Demo source used for 15-day AI visibility history: ${source.title}.`,
        content_length: 400,
        source_type: source.source_type as any,
        url_type: source.url_type as any,
        platform: "platform" in source ? source.platform : null,
        subreddit: "subreddit" in source ? source.subreddit : null,
        mentioned_brands: [source.title, ...competitors],
        fetch_status: "SUCCESS",
        content_updated_at: new Date(),
      },
    })
  }
}

async function seed() {
  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    include: { projects: { orderBy: { created_at: "asc" } } },
  })

  const project = user?.projects[0] ?? await prisma.project.findFirst({ orderBy: { created_at: "asc" } })
  if (!project) {
    throw new Error("No project found. Complete onboarding once, then rerun this seed.")
  }

  await deletePreviousDemoRuns(project.id)
  await ensureCompetitors(project.id)
  await ensureSourceContent()
  const prompts = await ensureDemoPrompts(project.id)

  let chatCount = 0
  let sourceCount = 0

  for (let daysAgo = 14; daysAgo >= 0; daysAgo -= 1) {
    const dayIndex = 14 - daysAgo
    const ranAt = dayAtOffset(daysAgo)
    const run = await prisma.run.create({
      data: {
        project_id: project.id,
        status: "SUCCESS",
        scheduled_for: ranAt,
        started_at: new Date(ranAt.getTime() - 4 * 60 * 1000),
        completed_at: new Date(ranAt.getTime() + 12 * 60 * 1000),
        ran_at: ranAt,
        error_reason: DEMO_TAG,
      },
    })

    for (const [promptIndex, prompt] of prompts.entries()) {
      await prisma.prompt.update({
        where: { id: prompt.id },
        data: { last_run_at: ranAt },
      })

      for (const [engineIndex, engine] of engines.entries()) {
        const mentionedOwnBrand = ownMentioned(dayIndex, promptIndex, engineIndex)
        const mentions = competitorMentions(dayIndex, promptIndex, engineIndex)
        const position = mentionedOwnBrand ? clamp(2 + ((dayIndex + promptIndex + engineIndex) % 5), 1, 8) : null
        const sentiment = mentionedOwnBrand ? Number((58 + dayIndex * 0.8 + promptIndex * 2 - engineIndex * 1.5).toFixed(1)) : null
        const completedAt = new Date(ranAt.getTime() + (promptIndex * engines.length + engineIndex + 1) * 60 * 1000)
        const answer = responseText(project.brand_name, prompt.text, engine, mentionedOwnBrand, mentions)

        const chat = await prisma.chat.create({
          data: {
            run_id: run.id,
            prompt_id: prompt.id,
            ai_model: engine,
            raw_response: answer,
            screenshot_path: `/demo/${DEMO_TAG.toLowerCase()}/${run.id}-${promptIndex}-${engine}.png`,
            brand_mentioned: mentionedOwnBrand,
            brand_position: position,
            sentiment_score: sentiment,
            created_at: completedAt,
          },
        })
        chatCount += 1

        await prisma.brandMention.createMany({
          data: mentions.map((name, mentionIndex) => ({
            chat_id: chat.id,
            brand_name: name,
            position: 1 + mentionIndex + ((dayIndex + engineIndex) % 4),
            sentiment_score: Number((54 + mentionIndex * 3 + ((dayIndex + promptIndex) % 8)).toFixed(1)),
            created_at: completedAt,
          })),
        })

        const selectedSources = pick(sourcePool, dayIndex + promptIndex * 2 + engineIndex, 3)
        const citationJson = selectedSources.map((source) => ({
          url: source.url,
          title: source.title,
          domain: source.domain,
        }))

        for (const [sourceIndex, source] of selectedSources.entries()) {
          const sourceContent = await prisma.sourceUrlContent.findUniqueOrThrow({ where: { url: source.url } })
          await prisma.source.create({
            data: {
              chat_id: chat.id,
              source_url_content_id: sourceContent.id,
              url: source.url,
              domain: source.domain,
              title: source.title,
              snippet: `Demo citation ${sourceIndex + 1} for ${engine} on ${prompt.topic}.`,
              source_type: source.source_type as any,
              url_type: source.url_type as any,
              platform: "platform" in source ? source.platform : null,
              subreddit: "subreddit" in source ? source.subreddit : null,
              is_cited: sourceIndex < 2,
              used_by_ai: true,
              mentioned_brands: [project.brand_name, ...mentions],
              created_at: completedAt,
            },
          })
          sourceCount += 1
        }

        const scrapeJob = await prisma.scrapeJob.create({
          data: {
            run_id: run.id,
            project_id: project.id,
            prompt_id: prompt.id,
            chat_id: chat.id,
            engine,
            status: "SUCCESS",
            profile: "demo-profile",
            answer_text: answer,
            raw_text: answer,
            citations: citationJson,
            screenshot_path: `/demo/${DEMO_TAG.toLowerCase()}/${run.id}-${promptIndex}-${engine}.png`,
            scheduled_for: ranAt,
            started_at: new Date(completedAt.getTime() - 45 * 1000),
            completed_at: completedAt,
            created_at: completedAt,
          },
        })

        await prisma.scrapeJob.update({
          where: { id: scrapeJob.id },
          data: { updated_at: completedAt },
        })
      }
    }
  }

  console.log(`Seeded ${DEMO_TAG} for ${project.brand_name}`)
  console.log(`Project: ${project.id}`)
  console.log(`Runs: 15, prompts: ${prompts.length}, engines: ${engines.length}, chats: ${chatCount}, sources: ${sourceCount}`)
}

seed()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
