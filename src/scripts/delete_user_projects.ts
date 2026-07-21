import 'dotenv/config'
import prisma from '../lib/prisma'

const userId = '8458292b-3ea3-457b-9fb9-46f5904e69af'

async function main() {
    console.log('Deleting scrape jobs and projects for user:', userId)
    
    const projects = await prisma.project.findMany({ where: { user_id: userId } })
    const projectIds = projects.map(p => p.id)
    console.log(`Found ${projectIds.length} projects:`, projectIds)
    
    if (projectIds.length > 0) {
        // Scrape jobs
        const deletedJobs = await prisma.scrapeJob.deleteMany({
            where: { project_id: { in: projectIds } }
        }).catch(e => { console.error('Error deleting scrape jobs', e.message); return { count: 0 } })
        console.log(`Deleted ${deletedJobs.count} scrape jobs.`)
        
        // Runs
        const deletedRuns = await prisma.run.deleteMany({
            where: { project_id: { in: projectIds } }
        }).catch(e => { console.error('Error deleting runs', e.message); return { count: 0 } })
        console.log(`Deleted ${deletedRuns.count} runs.`)
        
        // AI Reports
        const deletedReports = await prisma.aIReport.deleteMany({
            where: { project_id: { in: projectIds } }
        }).catch(e => { console.error('Error deleting AI reports', e.message); return { count: 0 } })
        console.log(`Deleted ${deletedReports.count} reports.`)

        // Prompts
        const deletedPrompts = await prisma.prompt.deleteMany({
            where: { project_id: { in: projectIds } }
        }).catch(e => { console.error('Error deleting prompts', e.message); return { count: 0 } })
        console.log(`Deleted ${deletedPrompts.count} prompts.`)

        // Competitors
        const deletedCompetitors = await prisma.competitor.deleteMany({
            where: { project_id: { in: projectIds } }
        }).catch(e => { console.error('Error deleting competitors', e.message); return { count: 0 } })
        console.log(`Deleted ${deletedCompetitors.count} competitors.`)

        // Sara Conversations
        const deletedSara = await prisma.saraConversation.deleteMany({
            where: { project_id: { in: projectIds } }
        }).catch(e => { console.error('Error deleting Sara conversations', e.message); return { count: 0 } })
        console.log(`Deleted ${deletedSara.count} Sara conversations.`)

        // Delete Projects
        const deletedProjects = await prisma.project.deleteMany({
            where: { user_id: userId }
        }).catch(e => { console.error('Error deleting projects directly', e.message); return { count: 0 } })
        console.log(`Deleted ${deletedProjects.count} projects.`)
    } else {
        console.log('No projects found to delete.')
    }
}

main().catch(console.error).finally(() => prisma.$disconnect())
