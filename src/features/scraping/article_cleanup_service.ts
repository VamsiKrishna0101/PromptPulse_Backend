import { prisma } from "../../lib/prisma"

/**
 * Deletes SourceUrlContent records that were updated more than 24 hours ago.
 * This is used to implement a 1-day TTL on full article text and save DB storage.
 * The related Source records will have their source_url_content_id set to NULL 
 * automatically by Prisma due to onDelete: SetNull.
 */
export async function cleanupOldArticleContents() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    try {
        const result = await prisma.sourceUrlContent.deleteMany({
            where: {
                updated_at: {
                    lt: twentyFourHoursAgo
                }
            }
        })
        
        console.log(`[cleanupOldArticleContents] Deleted ${result.count} old article records (older than 24h).`)
        return result.count
    } catch (error) {
        console.error("[cleanupOldArticleContents] Failed to clean up old articles:", error)
        throw error
    }
}
