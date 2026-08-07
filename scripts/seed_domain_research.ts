import "dotenv/config"
import prisma from "../src/lib/prisma"

async function main() {
    const user = await prisma.user.findUnique({
        where: { email: "vamsi.krishna@refractone.com" }
    })

    if (!user) {
        console.error("User vamsi.krishna@refractone.com not found!")
        process.exit(1)
    }

    const project = await prisma.project.findFirst({
        where: { user_id: user.id }
    })

    if (!project) {
        console.error("No project found for user!")
        process.exit(1)
    }

    const domain = "refractone.com"
    const locationCode = 2840
    const languageCode = "en"
    const countryIsoCode = "US"

    console.log(`Seeding domain research data for project ${project.id} (${domain})`)

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)

    // Clear existing snapshots for this domain
    await prisma.seoDomainResearchOverviewSnapshot.deleteMany({
        where: { project_id: project.id, target_domain: domain }
    })
    await prisma.seoDomainResearchKeywordSnapshot.deleteMany({
        where: { project_id: project.id, target_domain: domain }
    })
    await prisma.seoDomainResearchTopPagesSnapshot.deleteMany({
        where: { project_id: project.id, target_domain: domain }
    })
    await prisma.seoDomainResearchCompetitorSnapshot.deleteMany({
        where: { project_id: project.id, target_domain: domain }
    })

    const target = {
        domain,
        locationCode,
        locationName: "United States",
        countryIsoCode,
        languageCode,
        languageName: "English"
    }

    const source = {
        provider: "dataforseo",
        environment: "sandbox",
        estimated: true
    }

    // --- OVERVIEW SNAPSHOT ---
    const history = Array.from({ length: 12 }).map((_, i) => {
        const d = new Date()
        d.setMonth(d.getMonth() - (11 - i))
        const year = d.getFullYear()
        const month = String(d.getMonth() + 1).padStart(2, "0")
        const traffic = 1200000 + (i * 150000) + Math.random() * 50000
        return {
            date: `${year}-${month}-01`,
            organic: { traffic, keywords: 450000 + (i * 20000), trafficValueUsd: traffic * 2.5 },
            paid: { traffic: traffic * 0.1, keywords: 15000, trafficValueUsd: traffic * 0.8 },
            rankingDistribution: { top3: 5000, positions4To10: 25000, positions11To20: 50000, positions21To50: 100000, positions51To100: 270000 },
            changes: { new: 1200, improved: 3400, declined: 2100, lost: 800 }
        }
    })

    const overviewPayload = {
        target,
        summary: {
            organic: history[11].organic,
            paid: history[11].paid
        },
        rankingDistribution: history[11].rankingDistribution,
        changes: history[11].changes,
        history,
        availableHistoryMonths: 12,
        source
    }

    await prisma.seoDomainResearchOverviewSnapshot.create({
        data: {
            project_id: project.id,
            requested_by_user_id: user.id,
            target_domain: domain,
            location_code: locationCode,
            country_iso_code: countryIsoCode,
            language_code: languageCode,
            history_months: 12,
            payload: overviewPayload as any,
            provider_environment: "sandbox",
            expires_at: tomorrow
        }
    })

    // --- KEYWORDS SNAPSHOT ---
    const keywords = Array.from({ length: 100 }).map((_, i) => {
        const volume = Math.floor(500000 / (i + 1))
        const position = Math.max(1, Math.floor(i / 10) + 1)
        const intents = ["INFORMATIONAL", "COMMERCIAL", "NAVIGATIONAL", "TRANSACTIONAL"]
        return {
            keyword: `seo tool ${i}`,
            position,
            absolutePosition: position,
            previousPosition: position + Math.floor(Math.random() * 3) - 1,
            movement: Math.random() > 0.5 ? "UP" : "DOWN",
            positionChange: 1,
            searchVolume: volume,
            cpcUsd: Number((Math.random() * 5).toFixed(2)),
            competition: 0.8,
            competitionLevel: "HIGH",
            difficulty: 80 + Math.floor(Math.random() * 20),
            intent: intents[i % 4],
            url: `https://${domain}/tools/seo-${i}`,
            relativeUrl: `/tools/seo-${i}`,
            title: `Best SEO Tool ${i}`,
            traffic: Math.floor(volume * 0.3),
            trafficValueUsd: Math.floor(volume * 0.3 * 2.5),
            serpFeatures: ["featured_snippet", "people_also_ask"],
            isFeaturedSnippet: i < 5
        }
    })

    const keywordsPayload = {
        target,
        summary: {
            totalKeywords: 450000,
            returnedKeywords: 100,
            top3: 5000,
            top10: 25000,
            top20: 50000,
            estimatedTraffic: 1200000,
            estimatedTrafficValueUsd: 3000000,
            new: 1200,
            improved: 3400,
            declined: 2100,
            lost: 800
        },
        keywords,
        source: { ...source, databaseRefresh: "weekly" }
    }

    await prisma.seoDomainResearchKeywordSnapshot.create({
        data: {
            project_id: project.id,
            requested_by_user_id: user.id,
            target_domain: domain,
            location_code: locationCode,
            country_iso_code: countryIsoCode,
            language_code: languageCode,
            item_limit: 100,
            total_count: 450000,
            payload: keywordsPayload as any,
            provider_environment: "sandbox",
            expires_at: tomorrow
        }
    })

    // --- TOP PAGES SNAPSHOT ---
    const pages = Array.from({ length: 50 }).map((_, i) => {
        const traffic = Math.floor(300000 / (i + 1))
        return {
            url: `https://${domain}/blog/post-${i}`,
            path: `/blog/post-${i}`,
            estimatedTraffic: traffic,
            trafficValueUsd: traffic * 2.5,
            rankingKeywords: 5000 - i * 50,
            top1Keywords: 100 - i,
            top3Keywords: 300 - i * 2,
            top10Keywords: 1000 - i * 10,
            top20Keywords: 2000 - i * 20,
            top50Keywords: 4000 - i * 40,
            top100Keywords: 5000 - i * 50,
            newKeywords: 50,
            improvedKeywords: 150,
            declinedKeywords: 40,
            lostKeywords: 10,
            status: i < 10 ? "WINNER" : "GROWING"
        }
    })

    const pagesPayload = {
        target,
        summary: {
            totalPages: 15000,
            returnedPages: 50,
            analyzedTraffic: 1200000,
            analyzedTrafficValueUsd: 3000000,
            pagesWithTop3Rankings: 4500,
            growingPages: 8000,
            decliningPages: 2000
        },
        pages,
        source: { ...source, databaseRefresh: "weekly" }
    }

    await prisma.seoDomainResearchTopPagesSnapshot.create({
        data: {
            project_id: project.id,
            requested_by_user_id: user.id,
            target_domain: domain,
            location_code: locationCode,
            country_iso_code: countryIsoCode,
            language_code: languageCode,
            item_limit: 50,
            total_count: 15000,
            payload: pagesPayload as any,
            provider_environment: "sandbox",
            expires_at: tomorrow
        }
    })

    // --- COMPETITORS SNAPSHOT ---
    const competitorsList = Array.from({ length: 25 }).map((_, i) => {
        const shared = Math.floor(100000 / (i + 1))
        return {
            domain: `competitor${i}.com`,
            averagePosition: 12.5 + i,
            sharedKeywords: shared,
            sharedCoveragePercent: (shared / 450000) * 100,
            totalKeywords: shared * 5,
            estimatedTraffic: shared * 15,
            trafficValueUsd: shared * 15 * 2.5,
            top3Keywords: Math.floor(shared * 0.05),
            top10Keywords: Math.floor(shared * 0.15),
            targetSharedTraffic: shared * 10,
            competitorSharedTraffic: shared * 12,
            sharedTrafficGap: shared * 2,
            newKeywords: 500,
            improvedKeywords: 1000,
            declinedKeywords: 800,
            lostKeywords: 200,
            strength: i < 3 ? "PRIMARY" : i < 10 ? "CHALLENGER" : "EMERGING"
        }
    })

    const competitorsPayload = {
        target: { ...target, totalKeywords: 450000 },
        summary: {
            totalCompetitors: 5000,
            returnedCompetitors: 25,
            primaryCompetitors: 3,
            challengers: 7,
            sharedKeywordUniverse: 150000,
            strongestCompetitor: "competitor0.com"
        },
        competitors: competitorsList,
        source: { ...source, databaseRefresh: "weekly", maxRankGroup: 20 }
    }

    await prisma.seoDomainResearchCompetitorSnapshot.create({
        data: {
            project_id: project.id,
            requested_by_user_id: user.id,
            target_domain: domain,
            location_code: locationCode,
            country_iso_code: countryIsoCode,
            language_code: languageCode,
            item_limit: 25,
            total_count: 5000,
            payload: competitorsPayload as any,
            provider_environment: "sandbox",
            expires_at: tomorrow
        }
    })

    console.log("Successfully seeded mock Domain Research data!")
}

main().catch(console.error).finally(() => prisma.$disconnect())
