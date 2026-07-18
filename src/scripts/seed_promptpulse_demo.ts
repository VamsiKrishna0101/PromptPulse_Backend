import "dotenv/config"
import bcrypt from "bcryptjs"
import prisma from "../lib/prisma"

const EMAIL = "vamsi.krishna@refractconsulting.com"
const PASSWORD = "Password123"
const BRAND = "PromptPulse"
const BRAND_URL = "https://promptpulse.com"

const engines = ["CHATGPT", "GEMINI", "PERPLEXITY"] as const

const topics = [
  "AI visibility",
  "GEO strategy",
  "Competitor monitoring",
  "Source intelligence",
  "B2B SaaS marketing",
]

const competitors = [
  { name: "Peec AI", url: "https://peec.ai" },
  { name: "PromptWatch", url: "https://promptwatch.io" },
  { name: "Profound", url: "https://profound.ai" },
  { name: "AthenaHQ", url: "https://athenahq.ai" },
  { name: "PromptMonitor", url: "https://promptmonitor.com" },
]

const prompts = [
  {
    text: "Best AI visibility tools for B2B SaaS marketing teams",
    topic: "AI visibility",
    type: "best_tools",
    priority_score: 0.94,
    volume_score: 0.82,
  },
  {
    text: "Which platforms help brands track mentions in ChatGPT and Perplexity?",
    topic: "Competitor monitoring",
    type: "category_discovery",
    priority_score: 0.89,
    volume_score: 0.78,
  },
  {
    text: "Top GEO tools for startups improving LLM search visibility",
    topic: "GEO strategy",
    type: "solution_research",
    priority_score: 0.91,
    volume_score: 0.73,
  },
  {
    text: "How can a B2B SaaS company improve AI search recommendations?",
    topic: "B2B SaaS marketing",
    type: "how_to",
    priority_score: 0.86,
    volume_score: 0.68,
  },
  {
    text: "Best tools to monitor competitor visibility across AI answer engines",
    topic: "Competitor monitoring",
    type: "competitor_comparison",
    priority_score: 0.88,
    volume_score: 0.71,
  },
  {
    text: "Which sources influence ChatGPT answers for AI visibility software?",
    topic: "Source intelligence",
    type: "source_research",
    priority_score: 0.84,
    volume_score: 0.65,
  },
]

const sources = [
  {
    domain: "searchengineland.com",
    url: "https://searchengineland.com/generative-engine-optimization-ai-search-visibility",
    title: "Generative engine optimization and AI search visibility trends",
    source_type: "EDITORIAL",
    url_type: "ARTICLE",
  },
  {
    domain: "hubspot.com",
    url: "https://blog.hubspot.com/marketing/ai-search-brand-visibility",
    title: "How marketers can improve brand visibility in AI search",
    source_type: "CORPORATE",
    url_type: "ARTICLE",
  },
  {
    domain: "g2.com",
    url: "https://www.g2.com/categories/ai-search-visibility",
    title: "Best AI search visibility software",
    source_type: "EDITORIAL",
    url_type: "REVIEW",
  },
  {
    domain: "reddit.com",
    url: "https://www.reddit.com/r/SEO/comments/ai_visibility_tools_for_saas/",
    title: "AI visibility tools for SaaS brands",
    source_type: "UGC",
    url_type: "DISCUSSION",
    platform: "reddit",
    subreddit: "r/SEO",
  },
  {
    domain: "linkedin.com",
    url: "https://www.linkedin.com/pulse/geo-strategy-b2b-saas-ai-search",
    title: "GEO strategy for B2B SaaS teams",
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
    domain: "profound.ai",
    url: "https://profound.ai/",
    title: "Profound",
    source_type: "COMPETITOR",
    url_type: "HOMEPAGE",
  },
  {
    domain: "promptpulse.com",
    url: "https://promptpulse.com/",
    title: "PromptPulse AI visibility platform",
    source_type: "YOU",
    url_type: "HOMEPAGE",
  },
  {
    domain: "promptpulse.com",
    url: "https://promptpulse.com/ai-visibility-tools",
    title: "AI visibility tools for B2B teams",
    source_type: "YOU",
    url_type: "ARTICLE",
  },
]

function dayAt(daysAgo: number, hour = 10) {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(hour, 30, 0, 0)
  return date
}

function pick<T>(items: T[], start: number, count: number) {
  return Array.from({ length: count }, (_, index) => items[(start + index) % items.length])
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function modelAnswer(engine: string, prompt: string, ownMentioned: boolean, mentionedBrands: string[]) {
  const intro: Record<string, string> = {
    CHATGPT: "A practical shortlist should compare tools by prompt coverage, source intelligence, competitor benchmarking, and actionability.",
    GEMINI: "For marketing teams evaluating AI visibility platforms, the strongest options are the ones that connect model responses to sources and business actions.",
    PERPLEXITY: "The category is moving toward platforms that monitor answer engines, cite source evidence, and recommend content fixes.",
  }

  const ownLine = ownMentioned
    ? "PromptPulse is a strong fit for lean B2B teams that want visibility tracking, source intelligence, competitor comparisons, and Sara-style recommendations without enterprise complexity."
    : "PromptPulse is relevant to this category, but it is not cited as consistently as the larger AI visibility platforms in current answer sets."

  return [
    intro[engine] ?? intro.CHATGPT,
    `${engine} would usually evaluate ${mentionedBrands.join(", ")} for this query.`,
    ownLine,
    "The most trusted evidence tends to come from review pages, SEO publications, community discussions, LinkedIn posts, and competitor homepages.",
    `Prompt tested: ${prompt}`,
  ].join("\n\n")
}

async function cleanProject(projectId: string) {
  const chats = await prisma.chat.findMany({
    where: { run: { project_id: projectId } },
    select: { id: true },
  })
  const chatIds = chats.map((chat) => chat.id)
  const runs = await prisma.run.findMany({ where: { project_id: projectId }, select: { id: true } })
  const runIds = runs.map((run) => run.id)
  const promptsForProject = await prisma.prompt.findMany({ where: { project_id: projectId }, select: { id: true } })
  const promptIds = promptsForProject.map((prompt) => prompt.id)
  const siteIds = (await prisma.webAnalyticsSite.findMany({ where: { project_id: projectId }, select: { id: true } })).map((site) => site.id)
  const conversationIds = (await prisma.saraConversation.findMany({ where: { project_id: projectId }, select: { id: true } })).map((conversation) => conversation.id)

  await prisma.source.deleteMany({ where: { chat_id: { in: chatIds } } })
  await prisma.brandMention.deleteMany({ where: { chat_id: { in: chatIds } } })
  await prisma.scrapeJob.deleteMany({ where: { run_id: { in: runIds } } })
  await prisma.chat.deleteMany({ where: { id: { in: chatIds } } })
  await prisma.run.deleteMany({ where: { id: { in: runIds } } })
  await prisma.geoPromptVariant.deleteMany({ where: { prompt_id: { in: promptIds } } })
  await prisma.prompt.deleteMany({ where: { project_id: projectId } })
  await prisma.competitor.deleteMany({ where: { project_id: projectId } })
  await prisma.topic.deleteMany({ where: { project_id: projectId } })
  await prisma.saraMessage.deleteMany({ where: { conversation_id: { in: conversationIds } } })
  await prisma.saraConversation.deleteMany({ where: { project_id: projectId } })
  await prisma.webAnalyticsAction.deleteMany({ where: { custom_event: { site_id: { in: siteIds } } } })
  await prisma.webAnalyticsCustomEvent.deleteMany({ where: { site_id: { in: siteIds } } })
  await prisma.webAnalyticsEvent.deleteMany({ where: { site_id: { in: siteIds } } })
  await prisma.webAnalyticsSession.deleteMany({ where: { site_id: { in: siteIds } } })
  await prisma.webAnalyticsSite.deleteMany({ where: { project_id: projectId } })
}

async function seedSources() {
  for (const source of sources) {
    await prisma.sourceUrlContent.upsert({
      where: { url: source.url },
      update: {
        domain: source.domain,
        title: source.title,
        content: `${source.title}. This source discusses AI visibility, GEO, source citations, and competitor positioning for B2B SaaS brands.`,
        snippet: `${source.title} is used as demo evidence for AI visibility answers.`,
        content_length: 540,
        source_type: source.source_type as any,
        url_type: source.url_type as any,
        platform: "platform" in source ? source.platform : null,
        subreddit: "subreddit" in source ? source.subreddit : null,
        mentioned_brands: [BRAND, ...competitors.map((competitor) => competitor.name)],
        fetch_status: "SUCCESS",
        content_updated_at: new Date(),
      },
      create: {
        url: source.url,
        domain: source.domain,
        title: source.title,
        content: `${source.title}. This source discusses AI visibility, GEO, source citations, and competitor positioning for B2B SaaS brands.`,
        snippet: `${source.title} is used as demo evidence for AI visibility answers.`,
        content_length: 540,
        source_type: source.source_type as any,
        url_type: source.url_type as any,
        platform: "platform" in source ? source.platform : null,
        subreddit: "subreddit" in source ? source.subreddit : null,
        mentioned_brands: [BRAND, ...competitors.map((competitor) => competitor.name)],
        fetch_status: "SUCCESS",
        content_updated_at: new Date(),
      },
    })
  }
}

async function seedWebAnalytics(projectId: string) {
  const site = await prisma.webAnalyticsSite.create({
    data: {
      project_id: projectId,
      name: "PromptPulse Website",
      domain: "promptpulse.com",
      public_key: `demo_${Date.now()}_promptpulse`,
      is_active: true,
    },
  })

  const signupEvent = await prisma.webAnalyticsCustomEvent.create({
    data: {
      site_id: site.id,
      title: "Trial signups",
      type: "TOTAL_CHART",
      key: "trial_signup",
    },
  })

  for (let day = 14; day >= 0; day -= 1) {
    const baseDate = dayAt(day, 11)
    const sessionsForDay = 7 + (14 - day) * 2
    for (let index = 0; index < sessionsForDay; index += 1) {
      const visitor = `demo-visitor-${day}-${index}`
      const session = await prisma.webAnalyticsSession.create({
        data: {
          site_id: site.id,
          visitor_id: visitor,
          browser: index % 3 === 0 ? "Chrome" : index % 3 === 1 ? "Safari" : "Edge",
          os: index % 2 === 0 ? "Windows" : "macOS",
          device: index % 4 === 0 ? "Mobile" : "Desktop",
          country: index % 5 === 0 ? "United States" : "India",
          referrer: index % 2 === 0 ? "https://chat.openai.com/" : "https://www.google.com/",
          source: index % 2 === 0 ? "chatgpt" : "google",
          medium: index % 2 === 0 ? "ai-answer" : "organic",
          landing_page: index % 2 === 0 ? "/ai-visibility-tools" : "/",
          started_at: new Date(baseDate.getTime() + index * 9 * 60 * 1000),
          last_seen_at: new Date(baseDate.getTime() + index * 9 * 60 * 1000 + 120000),
        },
      })

      await prisma.webAnalyticsEvent.create({
        data: {
          site_id: site.id,
          session_id: session.id,
          type: "PAGE_VIEW",
          path: session.landing_page ?? "/",
          url: `https://promptpulse.com${session.landing_page ?? "/"}`,
          title: "PromptPulse - AI Visibility Platform",
          referrer: session.referrer,
          duration_ms: 85000 + index * 3000,
          created_at: session.started_at,
        },
      })

      if (index % 6 === 0) {
        await prisma.webAnalyticsAction.create({
          data: {
            custom_event_id: signupEvent.id,
            session_id: session.id,
            key: "trial_signup",
            value: 1,
            details: "Demo trial signup from landing page",
            created_at: new Date(session.started_at.getTime() + 65000),
          },
        })
      }
    }
  }
}

async function seedSara(userId: string, projectId: string) {
  const conversation = await prisma.saraConversation.create({
    data: {
      user_id: userId,
      project_id: projectId,
      title: "Visibility summary and next fixes",
    },
  })

  await prisma.saraMessage.createMany({
    data: [
      {
        conversation_id: conversation.id,
        role: "USER",
        content: "Summarize my brand visibility this week",
        created_at: dayAt(1, 16),
      },
      {
        conversation_id: conversation.id,
        role: "ASSISTANT",
        content:
          "PromptPulse is appearing in 64% of tracked AI answers this week, with the strongest visibility in GEO strategy and AI visibility tool prompts. The biggest gap is competitor comparison prompts where Peec AI and PromptWatch are cited more often from third-party sources.",
        citations: [
          { title: "AI search brand visibility guide", domain: "hubspot.com" },
          { title: "Generative engine optimization and AI search visibility trends", domain: "searchengineland.com" },
        ],
        suggested_actions: [
          "Publish a competitor comparison page",
          "Refresh source citations on PromptPulse.com",
          "Target G2 and Reddit discussions",
        ],
        confidence: "high",
        created_at: dayAt(1, 16),
      },
      {
        conversation_id: conversation.id,
        role: "USER",
        content: "What should we fix first?",
        created_at: dayAt(0, 10),
      },
      {
        conversation_id: conversation.id,
        role: "ASSISTANT",
        content:
          "Fix the source gap first. AI engines already understand the category, but they trust external review and editorial sources more than your homepage. Start with a 'best AI visibility tools' article, add competitor comparison sections, and strengthen proof on pages that are already being cited.",
        citations: [
          { title: "Best AI search visibility software", domain: "g2.com" },
          { title: "AI visibility tools for SaaS brands", domain: "reddit.com" },
        ],
        suggested_actions: [
          "Create AEO article brief",
          "Add comparison table",
          "Improve proof points",
        ],
        confidence: "high",
        created_at: dayAt(0, 10),
      },
    ],
  })
}

async function main() {
  const hashedPassword = await bcrypt.hash(PASSWORD, 10)
  const now = new Date()
  const trialEnd = new Date(now)
  trialEnd.setDate(trialEnd.getDate() + 7)

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {
      password: hashedPassword,
      is_verified: true,
      account_type: "SINGLE",
      plan: "GROWTH",
    },
    create: {
      email: EMAIL,
      password: hashedPassword,
      is_verified: true,
      account_type: "SINGLE",
      plan: "GROWTH",
    },
  })

  const project = await prisma.project.upsert({
    where: { brand_name: BRAND },
    update: {
      brand_url: BRAND_URL,
      brand_location: "United States",
      user_id: user.id,
    },
    create: {
      brand_name: BRAND,
      brand_url: BRAND_URL,
      brand_location: "United States",
      user_id: user.id,
    },
  })

  await cleanProject(project.id)

  await prisma.subscription.deleteMany({ where: { user_id: user.id } })
  await prisma.planUsage.deleteMany({ where: { user_id: user.id } })
  await prisma.helpCenter.deleteMany({ where: { user_id: user.id } })

  await prisma.subscription.create({
    data: {
      user_id: user.id,
      plan: "GROWTH",
      status: "TRIALING",
      amount_cents: 7900,
      currency: "usd",
      current_period_start: now,
      current_period_end: trialEnd,
      trial_starts_at: now,
      trial_ends_at: trialEnd,
    },
  })

  await prisma.planUsage.create({
    data: {
      user_id: user.id,
      prompt_count: prompts.length,
      project_count: 1,
      competitor_count: competitors.length,
      monthly_runs_used: 15,
      period_start: dayAt(14, 0),
      period_end: trialEnd,
    },
  })

  await Promise.all(topics.map((name) => prisma.topic.create({ data: { name, project_id: project.id } })))
  await Promise.all(competitors.map((competitor) => prisma.competitor.create({ data: { ...competitor, project_id: project.id } })))
  await seedSources()

  const createdPrompts = []
  for (const prompt of prompts) {
    createdPrompts.push(await prisma.prompt.create({
      data: {
        ...prompt,
        project_id: project.id,
        status: "ACTIVE",
        source: "GENERATED",
        geo_enabled: true,
        last_run_at: dayAt(0),
      },
    }))
  }

  let chatCount = 0
  for (let daysAgo = 14; daysAgo >= 0; daysAgo -= 1) {
    const dayIndex = 14 - daysAgo
    const runDate = dayAt(daysAgo)
    const run = await prisma.run.create({
      data: {
        project_id: project.id,
        status: "SUCCESS",
        scheduled_for: runDate,
        started_at: new Date(runDate.getTime() - 180000),
        completed_at: new Date(runDate.getTime() + 900000),
        ran_at: runDate,
      },
    })

    for (const [promptIndex, prompt] of createdPrompts.entries()) {
      for (const [engineIndex, engine] of engines.entries()) {
        const ownMentioned = (dayIndex + promptIndex + engineIndex) % 10 !== 0
        const position = ownMentioned ? clamp(2 + ((dayIndex + promptIndex + engineIndex) % 5), 1, 7) : null
        const sentiment = ownMentioned ? Number((62 + dayIndex * 0.55 + promptIndex * 1.7 - engineIndex * 1.2).toFixed(1)) : null
        const mentionedCompetitors = pick(competitors, dayIndex + promptIndex + engineIndex, 3).map((competitor) => competitor.name)
        const response = modelAnswer(engine, prompt.text, ownMentioned, ownMentioned ? [BRAND, ...mentionedCompetitors] : mentionedCompetitors)
        const createdAt = new Date(runDate.getTime() + (promptIndex * engines.length + engineIndex) * 60000)

        const chat = await prisma.chat.create({
          data: {
            run_id: run.id,
            prompt_id: prompt.id,
            ai_model: engine,
            raw_response: response,
            screenshot_path: `/demo/promptpulse/${run.id}-${promptIndex}-${engine}.png`,
            brand_mentioned: ownMentioned,
            brand_position: position,
            sentiment_score: sentiment,
            geo_country_code: "US",
            geo_country_name: "United States",
            created_at: createdAt,
          },
        })
        chatCount += 1

        const brandMentionData = [
          ...(ownMentioned ? [{
            chat_id: chat.id,
            brand_name: BRAND,
            position,
            sentiment_score: sentiment,
            created_at: createdAt,
          }] : []),
          ...mentionedCompetitors.map((name, index) => ({
            chat_id: chat.id,
            brand_name: name,
            position: 1 + index + ((dayIndex + engineIndex) % 3),
            sentiment_score: Number((58 + index * 2.5 + ((dayIndex + promptIndex) % 9)).toFixed(1)),
            created_at: createdAt,
          })),
        ]
        await prisma.brandMention.createMany({ data: brandMentionData })

        const selectedSources = pick(sources, dayIndex + promptIndex * 2 + engineIndex, 4)
        for (const [sourceIndex, source] of selectedSources.entries()) {
          const sourceContent = await prisma.sourceUrlContent.findUniqueOrThrow({ where: { url: source.url } })
          await prisma.source.create({
            data: {
              chat_id: chat.id,
              source_url_content_id: sourceContent.id,
              url: source.url,
              domain: source.domain,
              title: source.title,
              snippet: `${engine} used this source while answering "${prompt.text}".`,
              source_type: source.source_type as any,
              url_type: source.url_type as any,
              platform: "platform" in source ? source.platform : null,
              subreddit: "subreddit" in source ? source.subreddit : null,
              is_cited: sourceIndex < 2,
              used_by_ai: true,
              mentioned_brands: [BRAND, ...mentionedCompetitors],
              created_at: createdAt,
            },
          })
        }

        await prisma.scrapeJob.create({
          data: {
            run_id: run.id,
            project_id: project.id,
            prompt_id: prompt.id,
            chat_id: chat.id,
            engine,
            status: "SUCCESS",
            profile: `${engine.toLowerCase()}_demo`,
            answer_text: response,
            raw_text: response,
            citations: selectedSources.slice(0, 3).map((source) => ({
              title: source.title,
              url: source.url,
              domain: source.domain,
            })),
            screenshot_path: `/demo/promptpulse/${run.id}-${promptIndex}-${engine}.png`,
            scheduled_for: runDate,
            started_at: new Date(createdAt.getTime() - 45000),
            completed_at: createdAt,
            created_at: createdAt,
          },
        })
      }
    }
  }

  await seedWebAnalytics(project.id)
  await seedSara(user.id, project.id)

  await prisma.helpCenter.create({
    data: {
      user_id: user.id,
      email: EMAIL,
      subject: "How do I improve AI visibility for competitor prompts?",
      message: "Demo ticket: I want to understand why PromptWatch is ranking above PromptPulse in comparison prompts.",
      is_resolved: false,
    },
  })

  console.log("PromptPulse demo seed complete")
  console.log(`Login: ${EMAIL}`)
  console.log(`Password: ${PASSWORD}`)
  console.log(`Project: ${project.id}`)
  console.log(`Prompts: ${createdPrompts.length}, competitors: ${competitors.length}, chats: ${chatCount}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
