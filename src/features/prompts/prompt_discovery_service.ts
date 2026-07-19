import prisma from "../../lib/prisma"
type Candidate = {
    text: string
    topic: string
    type: string
    tags: string[]
    priority_score: number
    volume_score: number | null
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

function uniqueByText(candidates: Candidate[]) {
    const seen = new Set<string>()
    return candidates.filter(candidate => {
        const key = normalize(candidate.text)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
    })
}

function clampScore(value: number) {
    return Math.max(10, Math.min(100, Math.round(value)))
}

function topicFromPromptTopic(topic: string) {
    return titleCase(topic || "Category Research")
}

export async function discoverPromptCandidates(project_id: string, options: {
    limit?: number
    runTag?: string
} = {}) {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: project_id },
        include: {
            competitors: true,
            prompts: {
                select: {
                    id: true,
                    text: true,
                    topic: true,
                    status: true,
                },
            },
        },
    })

    const chats = await prisma.chat.findMany({
        where: { run: { project_id } },
        include: {
            prompt: { select: { topic: true, text: true } },
            brand_mentions: { select: { brand_name: true, position: true, sentiment_score: true } },
            sources: { select: { domain: true, title: true, source_type: true, is_cited: true } },
        },
        orderBy: { created_at: "desc" },
        take: 200,
    })

    const existingTexts = new Set(project.prompts.map(prompt => normalize(prompt.text)))
    const topicStats = new Map<string, {
        runs: number
        brandMentions: number
        competitorMentions: Map<string, number>
        sources: Map<string, number>
    }>()

    for (const chat of chats) {
        const topic = topicFromPromptTopic(chat.prompt.topic)
        const stats = topicStats.get(topic) ?? {
            runs: 0,
            brandMentions: 0,
            competitorMentions: new Map<string, number>(),
            sources: new Map<string, number>(),
        }

        stats.runs += 1
        if (chat.brand_mentioned) stats.brandMentions += 1

        for (const mention of chat.brand_mentions) {
            const name = mention.brand_name.trim()
            if (!name || name.toLowerCase() === project.brand_name.toLowerCase()) continue
            stats.competitorMentions.set(name, (stats.competitorMentions.get(name) ?? 0) + 1)
        }

        for (const source of chat.sources) {
            if (!source.domain) continue
            stats.sources.set(source.domain, (stats.sources.get(source.domain) ?? 0) + 1)
        }

        topicStats.set(topic, stats)
    }

    if (topicStats.size === 0) {
        for (const prompt of project.prompts) {
            topicStats.set(topicFromPromptTopic(prompt.topic), {
                runs: 0,
                brandMentions: 0,
                competitorMentions: new Map(),
                sources: new Map(),
            })
        }
    }

    const candidates: Candidate[] = []
    const knownCompetitors = project.competitors.map(competitor => competitor.name).filter(Boolean)

    for (const [topic, stats] of topicStats) {
        const visibility = stats.runs ? (stats.brandMentions / stats.runs) * 100 : 0
        const opportunity = 100 - visibility
        const topCompetitors = [...stats.competitorMentions.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name)
            .slice(0, 3)
        const competitors = topCompetitors.length ? topCompetitors : knownCompetitors.slice(0, 3)
        const sourceDomains = [...stats.sources.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([domain]) => domain)
            .slice(0, 3)

        const baseScore = clampScore(45 + opportunity * 0.35 + Math.min(stats.runs, 30))
        const evidenceTags = [
            "discovery:evidence-backed",
            stats.runs ? "source:ai_answers" : "source:project_context",
            competitors.length ? "source:competitor_mentions" : "source:category_template",
            sourceDomains.length ? "source:citation_patterns" : "source:no_citation_data",
        ]

        candidates.push(
            {
                text: `what are the best ${topic.toLowerCase()} tools right now?`,
                topic,
                type: "category_discovery",
                tags: [...evidenceTags, "intent:best_tools"],
                priority_score: baseScore,
                volume_score: null,
            },
            {
                text: `which ${topic.toLowerCase()} platform should my team use?`,
                topic,
                type: "buyer_shortlist",
                tags: [...evidenceTags, "intent:buyer_shortlist"],
                priority_score: clampScore(baseScore + 4),
                volume_score: null,
            },
            {
                text: `how do i choose a ${topic.toLowerCase()} platform for my company?`,
                topic,
                type: "decision_support",
                tags: [...evidenceTags, "intent:how_to_choose"],
                priority_score: clampScore(baseScore - 2),
                volume_score: null,
            },
        )

        for (const competitor of competitors.slice(0, 2)) {
            candidates.push(
                {
                    text: `what are the best alternatives to ${competitor}?`,
                    topic,
                    type: "alternatives",
                    tags: [...evidenceTags, "intent:alternatives", `competitor:${competitor}`],
                    priority_score: clampScore(baseScore + 8),
                    volume_score: null,
                },
                {
                    text: `${competitor} vs other ${topic.toLowerCase()} tools`,
                    topic,
                    type: "comparison",
                    tags: [...evidenceTags, "intent:comparison", `competitor:${competitor}`],
                    priority_score: clampScore(baseScore + 6),
                    volume_score: null,
                },
            )
        }

        if (sourceDomains.length) {
            candidates.push({
                text: `which sources do ai assistants trust for ${topic.toLowerCase()} recommendations?`,
                topic,
                type: "source_influence",
                tags: [...evidenceTags, "intent:sources", ...sourceDomains.map(domain => `source_domain:${domain}`)],
                priority_score: clampScore(baseScore + 5),
                volume_score: null,
            })
        }
    }

    const deduped = uniqueByText(candidates)
        .filter(candidate => !existingTexts.has(normalize(candidate.text)))
        .sort((a, b) => b.priority_score - a.priority_score)
        .slice(0, Math.max(1, Math.min(25, options.limit ?? 12)))

    let created = 0
    let skipped = Math.max(0, uniqueByText(candidates).filter(candidate => !existingTexts.has(normalize(candidate.text))).length - deduped.length)

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

    return {
        created,
        skipped,
        total_candidates: deduped.length,
        message: created
            ? `Found ${created} evidence-backed prompt suggestions.`
            : "No new prompt suggestions found. Your current set already covers the discovered intents.",
    }
}
