import prisma from "../../lib/prisma"

type PromptIntent =
    | "best_recommendation"
    | "local"
    | "service_specific"
    | "problem_led"
    | "comparison"
    | "trust_reviews"
    | "pricing_cost"
    | "insurance_payment"
    | "emergency"
    | "alternatives"
    | "source_influence"

type Funnel = "HIGH" | "MEDIUM" | "LOW"
type Frequency = "daily" | "weekly" | "monthly"

type Candidate = {
    text: string
    topic: string
    type: string
    intent: PromptIntent
    funnel: Funnel
    frequency: Frequency
    tags: string[]
    priority_score: number
    volume_score: number | null
}

type ProjectContext = {
    brandName: string
    brandUrl: string
    location: string
    industry: string
    buyerPersona: string | null
    keywords: string[]
    avoidKeywords: string[]
    competitors: string[]
    existingTopics: string[]
    existingPromptTexts: string[]
    evidenceTopics: string[]
    evidenceCompetitors: string[]
    evidenceSources: string[]
}

function normalize(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

function titleCase(value: string) {
    return value
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, char => char.toUpperCase())
}

function clean(value: string) {
    return value.trim().replace(/\s+/g, " ")
}

function clampScore(value: number) {
    return Math.max(10, Math.min(100, Math.round(value)))
}

function safeStringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string").map(clean).filter(Boolean)
        : []
}

function cityFromLocation(location: string) {
    const cleaned = clean(location)
    if (!cleaned) return ""
    return cleaned.split(",")[0]?.trim() || cleaned
}

function hasAny(text: string, words: string[]) {
    const normalized = normalize(text)
    return words.some(word => normalized.includes(normalize(word)))
}

function industryKind(industry: string, brandName: string, keywords: string[]) {
    const haystack = `${industry} ${brandName} ${keywords.join(" ")}`.toLowerCase()
    if (hasAny(haystack, ["hospital", "clinic", "healthcare", "doctor", "medical", "multispeciality", "speciality", "specialty"])) return "healthcare"
    if (hasAny(haystack, ["real estate", "property", "realtor", "builder", "apartment", "villa"])) return "real_estate"
    if (hasAny(haystack, ["law", "legal", "lawyer", "attorney", "advocate"])) return "legal"
    if (hasAny(haystack, ["school", "college", "university", "education", "course", "academy"])) return "education"
    if (hasAny(haystack, ["hotel", "resort", "restaurant", "cafe", "travel"])) return "hospitality"
    return "general"
}

function addCandidate(candidates: Candidate[], input: Omit<Candidate, "tags" | "priority_score" | "volume_score"> & {
    score: number
    tags?: string[]
    volume?: number | null
}) {
    const text = clean(input.text).replace(/\?+$/, "?")
    if (text.length < 16) return

    candidates.push({
        text,
        topic: input.topic,
        type: input.type,
        intent: input.intent,
        funnel: input.funnel,
        frequency: input.frequency,
        tags: [
            "discovery:prompt_intelligence",
            `intent:${input.intent}`,
            `funnel:${input.funnel.toLowerCase()}`,
            `frequency:${input.frequency}`,
            ...(input.tags ?? []),
        ],
        priority_score: clampScore(input.score),
        volume_score: input.volume ?? null,
    })
}

function defaultHealthcareServices(keywords: string[]) {
    const weakServices = new Set([
        "hospital",
        "hospitals",
        "clinic",
        "clinics",
        "healthcare",
        "health care",
        "medical",
        "doctor",
        "doctors",
        "multispeciality",
        "multi speciality",
        "multi specialty",
        "speciality",
        "specialty",
    ])
    const known = [
        "cardiology",
        "orthopedics",
        "maternity",
        "gynecology",
        "pediatrics",
        "neurology",
        "gastroenterology",
        "urology",
        "oncology",
        "general surgery",
        "emergency care",
        "ICU",
        "diagnostics",
    ]
    const merged = [...keywords, ...known]
    return [...new Set(merged.map(item => clean(item)).filter(Boolean))]
        .filter(item => !weakServices.has(item.toLowerCase()))
        .filter(item => item.length <= 40)
        .slice(0, 14)
}

function genericServices(ctx: ProjectContext) {
    const fromKeywords = ctx.keywords.filter(item => item.length <= 50)
    const fromTopics = ctx.existingTopics.filter(item => !["No topic", "Category Research"].includes(item)).slice(0, 8)
    const fallback = ["service provider", "solution", "company", "agency"]
    return [...new Set([...fromKeywords, ...fromTopics, ...fallback].map(clean).filter(Boolean))].slice(0, 10)
}

function buildHealthcareCandidates(ctx: ProjectContext) {
    const candidates: Candidate[] = []
    const city = cityFromLocation(ctx.location)
    const location = city || ctx.location || "near me"
    const services = defaultHealthcareServices(ctx.keywords)
    const competitors = [...new Set([...ctx.evidenceCompetitors, ...ctx.competitors])].slice(0, 4)
    const evidenceTags = [
        ctx.evidenceSources.length ? "source:citation_patterns" : "source:project_context",
        ctx.evidenceTopics.length ? "source:existing_runs" : "source:industry_playbook",
        "industry:healthcare",
    ]

    addCandidate(candidates, {
        text: `Which is the best multispeciality hospital in ${location}?`,
        topic: "Local Hospital Discovery",
        type: "local_buyer_recommendation",
        intent: "best_recommendation",
        funnel: "HIGH",
        frequency: "daily",
        score: 96,
        tags: evidenceTags,
    })
    addCandidate(candidates, {
        text: `Which hospital in ${location} is best for emergency care at night?`,
        topic: "Emergency Care",
        type: "urgent_care_decision",
        intent: "emergency",
        funnel: "HIGH",
        frequency: "daily",
        score: 95,
        tags: evidenceTags,
    })
    addCandidate(candidates, {
        text: `Which hospital in ${location} has good ICU and critical care facilities?`,
        topic: "Emergency Care",
        type: "critical_care_decision",
        intent: "emergency",
        funnel: "HIGH",
        frequency: "daily",
        score: 92,
        tags: evidenceTags,
    })
    addCandidate(candidates, {
        text: `Which hospital in ${location} has good doctors and patient reviews?`,
        topic: "Trust & Reviews",
        type: "trust_review_decision",
        intent: "trust_reviews",
        funnel: "HIGH",
        frequency: "daily",
        score: 90,
        tags: evidenceTags,
    })
    addCandidate(candidates, {
        text: `Which hospital in ${location} accepts cashless insurance for surgery?`,
        topic: "Insurance & Cost",
        type: "insurance_decision",
        intent: "insurance_payment",
        funnel: "HIGH",
        frequency: "daily",
        score: 88,
        tags: evidenceTags,
    })
    addCandidate(candidates, {
        text: `Which hospital in ${location} is affordable but reliable for family treatment?`,
        topic: "Insurance & Cost",
        type: "cost_value_decision",
        intent: "pricing_cost",
        funnel: "HIGH",
        frequency: "daily",
        score: 86,
        tags: evidenceTags,
    })

    for (const service of services.slice(0, 10)) {
        const readable = service.toLowerCase()
        const topic = titleCase(service)
        const highValue = hasAny(readable, ["cardiology", "orthopedic", "maternity", "surgery", "emergency", "icu", "oncology"])
        addCandidate(candidates, {
            text: `Best hospital for ${readable} in ${location}?`,
            topic,
            type: "service_specific_decision",
            intent: "service_specific",
            funnel: "HIGH",
            frequency: highValue ? "daily" : "weekly",
            score: highValue ? 92 : 82,
            tags: [...evidenceTags, `service:${normalize(service).replace(/\s+/g, "_")}`],
        })
        addCandidate(candidates, {
            text: `Which ${readable} hospital in ${location} has experienced doctors?`,
            topic,
            type: "doctor_trust_decision",
            intent: "trust_reviews",
            funnel: "HIGH",
            frequency: highValue ? "daily" : "weekly",
            score: highValue ? 89 : 78,
            tags: [...evidenceTags, `service:${normalize(service).replace(/\s+/g, "_")}`],
        })
    }

    const symptomPrompts = [
        ["chest pain", "cardiology"],
        ["severe stomach pain", "gastroenterology"],
        ["pregnancy delivery", "maternity"],
        ["knee pain or joint pain", "orthopedics"],
        ["child fever at night", "pediatrics"],
    ] as const
    for (const [problem, topic] of symptomPrompts) {
        addCandidate(candidates, {
            text: `My family member has ${problem}; which hospital in ${location} should I choose?`,
            topic: titleCase(topic),
            type: "problem_led_decision",
            intent: "problem_led",
            funnel: "HIGH",
            frequency: "daily",
            score: 91,
            tags: [...evidenceTags, `problem:${normalize(problem).replace(/\s+/g, "_")}`],
        })
    }

    for (const competitor of competitors.slice(0, 3)) {
        addCandidate(candidates, {
            text: `${ctx.brandName} vs ${competitor}: which hospital is better in ${location}?`,
            topic: "Competitor Comparison",
            type: "competitor_comparison",
            intent: "comparison",
            funnel: "HIGH",
            frequency: "daily",
            score: 94,
            tags: [...evidenceTags, `competitor:${competitor}`],
        })
        addCandidate(candidates, {
            text: `What are the best alternatives to ${competitor} hospital in ${location}?`,
            topic: "Competitor Comparison",
            type: "alternatives",
            intent: "alternatives",
            funnel: "HIGH",
            frequency: "weekly",
            score: 86,
            tags: [...evidenceTags, `competitor:${competitor}`],
        })
    }

    if (ctx.evidenceSources.length) {
        addCandidate(candidates, {
            text: `Which sources does AI trust when recommending hospitals in ${location}?`,
            topic: "Source Influence",
            type: "source_influence",
            intent: "source_influence",
            funnel: "MEDIUM",
            frequency: "weekly",
            score: 78,
            tags: [...evidenceTags, ...ctx.evidenceSources.slice(0, 3).map(domain => `source_domain:${domain}`)],
        })
    }

    return candidates
}

function buildGeneralCandidates(ctx: ProjectContext) {
    const candidates: Candidate[] = []
    const city = cityFromLocation(ctx.location)
    const location = city || ctx.location
    const services = genericServices(ctx)
    const competitors = [...new Set([...ctx.evidenceCompetitors, ...ctx.competitors])].slice(0, 4)
    const evidenceTags = [
        ctx.evidenceSources.length ? "source:citation_patterns" : "source:project_context",
        ctx.evidenceTopics.length ? "source:existing_runs" : "source:industry_playbook",
        `industry:${normalize(ctx.industry || "general").replace(/\s+/g, "_")}`,
    ]
    const localSuffix = location ? ` in ${location}` : ""

    addCandidate(candidates, {
        text: `Which ${ctx.industry || "company"} should I choose${localSuffix}?`,
        topic: "Buyer Shortlist",
        type: "buyer_shortlist",
        intent: "best_recommendation",
        funnel: "HIGH",
        frequency: "daily",
        score: 90,
        tags: evidenceTags,
    })
    addCandidate(candidates, {
        text: `What are the best ${ctx.industry || "services"}${localSuffix}?`,
        topic: "Best Recommendations",
        type: "category_discovery",
        intent: "best_recommendation",
        funnel: "HIGH",
        frequency: "daily",
        score: 88,
        tags: evidenceTags,
    })
    addCandidate(candidates, {
        text: `Which ${ctx.industry || "provider"} has the best reviews and proof${localSuffix}?`,
        topic: "Trust & Reviews",
        type: "trust_review_decision",
        intent: "trust_reviews",
        funnel: "HIGH",
        frequency: "weekly",
        score: 84,
        tags: evidenceTags,
    })

    for (const service of services.slice(0, 8)) {
        addCandidate(candidates, {
            text: `Best ${service.toLowerCase()} provider${localSuffix}?`,
            topic: titleCase(service),
            type: "service_specific_decision",
            intent: "service_specific",
            funnel: "HIGH",
            frequency: "weekly",
            score: 84,
            tags: [...evidenceTags, `service:${normalize(service).replace(/\s+/g, "_")}`],
        })
        addCandidate(candidates, {
            text: `How do I choose a reliable ${service.toLowerCase()} provider${localSuffix}?`,
            topic: titleCase(service),
            type: "decision_support",
            intent: "problem_led",
            funnel: "MEDIUM",
            frequency: "weekly",
            score: 72,
            tags: [...evidenceTags, `service:${normalize(service).replace(/\s+/g, "_")}`],
        })
    }

    for (const competitor of competitors.slice(0, 3)) {
        addCandidate(candidates, {
            text: `${ctx.brandName} vs ${competitor}: which is better?`,
            topic: "Competitor Comparison",
            type: "competitor_comparison",
            intent: "comparison",
            funnel: "HIGH",
            frequency: "daily",
            score: 92,
            tags: [...evidenceTags, `competitor:${competitor}`],
        })
        addCandidate(candidates, {
            text: `What are the best alternatives to ${competitor}?`,
            topic: "Competitor Comparison",
            type: "alternatives",
            intent: "alternatives",
            funnel: "HIGH",
            frequency: "weekly",
            score: 86,
            tags: [...evidenceTags, `competitor:${competitor}`],
        })
    }

    if (ctx.evidenceSources.length) {
        addCandidate(candidates, {
            text: `Which sources do AI assistants trust for ${ctx.industry || "this category"} recommendations?`,
            topic: "Source Influence",
            type: "source_influence",
            intent: "source_influence",
            funnel: "MEDIUM",
            frequency: "weekly",
            score: 76,
            tags: [...evidenceTags, ...ctx.evidenceSources.slice(0, 3).map(domain => `source_domain:${domain}`)],
        })
    }

    return candidates
}

function qualityPenalty(candidate: Candidate, ctx: ProjectContext) {
    let penalty = 0
    const text = normalize(candidate.text)
    if (text.split(" ").length < 5) penalty += 20
    if (candidate.funnel === "LOW") penalty += 8
    if (ctx.location && ["local", "service_specific", "emergency", "best_recommendation"].includes(candidate.intent) && !text.includes(normalize(cityFromLocation(ctx.location)))) {
        penalty += 8
    }
    for (const avoid of ctx.avoidKeywords) {
        if (avoid && text.includes(normalize(avoid))) penalty += 30
    }
    if (/^what is\b/.test(text) && !text.includes("which")) penalty += 18
    return penalty
}

function dedupeByIntent(candidates: Candidate[], existingTexts: Set<string>, ctx: ProjectContext) {
    const seen = new Set<string>()
    const sorted = candidates
        .map(candidate => ({
            ...candidate,
            priority_score: clampScore(candidate.priority_score - qualityPenalty(candidate, ctx)),
        }))
        .filter(candidate => candidate.priority_score >= 50)
        .filter(candidate => !existingTexts.has(normalize(candidate.text)))
        .sort((a, b) => b.priority_score - a.priority_score)

    const result: Candidate[] = []
    const bucketCount = new Map<string, number>()
    for (const candidate of sorted) {
        const key = normalize(candidate.text)
        if (!key || seen.has(key)) continue
        const intentCount = bucketCount.get(candidate.intent) ?? 0
        if (intentCount >= 8) continue
        seen.add(key)
        bucketCount.set(candidate.intent, intentCount + 1)
        result.push(candidate)
    }
    return result
}

async function buildContext(project_id: string): Promise<ProjectContext> {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: project_id },
        include: {
            competitors: true,
            brand_preference: true,
            prompts: {
                select: {
                    text: true,
                    topic: true,
                },
            },
        },
    })

    const chats = await prisma.chat.findMany({
        where: { run: { project_id } },
        include: {
            prompt: { select: { topic: true, text: true } },
            brand_mentions: { select: { brand_name: true } },
            sources: { select: { domain: true, is_cited: true } },
        },
        orderBy: { created_at: "desc" },
        take: 250,
    })

    const evidenceTopics = [...new Set(chats.map(chat => titleCase(chat.prompt.topic)).filter(Boolean))]
    const competitorCounts = new Map<string, number>()
    const sourceCounts = new Map<string, number>()
    for (const chat of chats) {
        for (const mention of chat.brand_mentions) {
            const name = clean(mention.brand_name)
            if (!name || name.toLowerCase() === project.brand_name.toLowerCase()) continue
            competitorCounts.set(name, (competitorCounts.get(name) ?? 0) + 1)
        }
        for (const source of chat.sources) {
            if (!source.domain) continue
            sourceCounts.set(source.domain, (sourceCounts.get(source.domain) ?? 0) + (source.is_cited ? 2 : 1))
        }
    }

    return {
        brandName: project.brand_name,
        brandUrl: project.brand_url,
        location: project.brand_location,
        industry: project.brand_preference?.industry_category ?? "Business",
        buyerPersona: project.brand_preference?.buyer_persona ?? null,
        keywords: safeStringArray(project.brand_preference?.keywords),
        avoidKeywords: safeStringArray(project.brand_preference?.avoid_keywords),
        competitors: project.competitors.map(competitor => competitor.name).filter(Boolean),
        existingTopics: [...new Set(project.prompts.map(prompt => titleCase(prompt.topic)).filter(Boolean))],
        existingPromptTexts: project.prompts.map(prompt => prompt.text),
        evidenceTopics,
        evidenceCompetitors: [...competitorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 5),
        evidenceSources: [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([domain]) => domain).slice(0, 5),
    }
}

export async function discoverPromptCandidates(project_id: string, options: {
    limit?: number
    runTag?: string
} = {}) {
    const ctx = await buildContext(project_id)
    const existingTexts = new Set(ctx.existingPromptTexts.map(normalize))
    const kind = industryKind(ctx.industry, ctx.brandName, ctx.keywords)
    const generated = kind === "healthcare"
        ? buildHealthcareCandidates(ctx)
        : buildGeneralCandidates(ctx)

    const deduped = dedupeByIntent(generated, existingTexts, ctx)
        .slice(0, Math.max(1, Math.min(60, options.limit ?? 30)))

    let created = 0
    let skipped = Math.max(0, generated.length - deduped.length)

    for (const candidate of deduped) {
        const existing = await prisma.prompt.findFirst({
            where: {
                project_id,
                text: { equals: candidate.text, mode: "insensitive" },
            },
            select: { id: true },
        })

        if (existing) {
            skipped += 1
            continue
        }

        await prisma.topic.upsert({
            where: {
                project_id_name: {
                    project_id,
                    name: candidate.topic,
                },
            },
            create: {
                project_id,
                name: candidate.topic,
            },
            update: {},
        })

        await prisma.prompt.create({
            data: {
                project_id,
                text: candidate.text,
                topic: candidate.topic,
                type: candidate.type,
                status: "SUGGESTED",
                source: "GENERATED",
                tags: options.runTag ? [...candidate.tags, options.runTag] : candidate.tags,
                priority_score: candidate.priority_score,
                volume_score: candidate.volume_score,
                is_active: false,
            },
        })

        created += 1
    }

    const industryLabel = kind === "healthcare" ? "healthcare/local buyer" : "buyer-intent"
    return {
        created,
        skipped,
        total_candidates: deduped.length,
        message: created
            ? `Found ${created} ${industryLabel} prompt suggestions with intent, funnel, and tracking frequency.`
            : "No new strong prompt suggestions found. Your current set already covers the discovered high-value intents.",
    }
}
