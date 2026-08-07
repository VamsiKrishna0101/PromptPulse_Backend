import { fetchRankTask } from "./rank_tracking_provider"
import { saveRankSnapshots, updateRankRun } from "./rank_tracking_repository"
import prisma from "../../../lib/prisma"

type TaskMapRow = {
    taskId: string
    trackingKeywordId: string
    keyword: string
    device: "desktop" | "mobile"
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function processStandardRankRun(input: {
    runId: string
    projectId: string
    userId: string
    domain: string
    configId: string
    nextCheckAt: Date | null
}) {
    const run = await prisma.seoRankCheckRun.findUnique({ where: { id: input.runId } })
    const taskMap = (Array.isArray(run?.provider_task_map) ? run.provider_task_map : []) as TaskMapRow[]
    const successes = [] as Awaited<ReturnType<typeof fetchRankTask>>[]
    const errors: string[] = []

    for (let attempt = 0; attempt < 60 && successes.length < taskMap.length; attempt += 1) {
        if (attempt > 0) await sleep(5000)
        const remaining = taskMap.filter(row => !successes.some(result => result.taskIds.includes(row.taskId)))
        const settled = await Promise.allSettled(remaining.map(row => fetchRankTask({
            taskId: row.taskId,
            trackingKeywordId: row.trackingKeywordId,
            keyword: row.keyword,
            device: row.device,
            targetDomain: input.domain,
        })))
        settled.forEach((result, index) => {
            if (result.status === "fulfilled" && result.value.data) successes.push(result.value)
            else if (result.status === "rejected" && attempt === 59) errors.push(result.reason instanceof Error ? result.reason.message : "Provider task failed")
        })
    }

    const costUsd = successes.reduce((sum, result) => sum + result.costUsd, 0)
    const checkedKeywordIds = new Set(successes.map(result => result.data.trackingKeywordId))
    const status = successes.length === taskMap.length ? "COMPLETED" : successes.length ? "PARTIAL" : "FAILED"
    if (successes.length) await saveRankSnapshots({ runId: input.runId, results: successes.map(result => result.data) })
    await updateRankRun(input.runId, {
        status,
        keywords_checked: checkedKeywordIds.size,
        provider_cost_usd: costUsd,
        credits_spent: run?.credits_spent ?? 0,
        error_message: errors.length ? errors.slice(0, 3).join("; ").slice(0, 1000) : null,
        completed_at: new Date(),
    })
    await prisma.seoRankTrackingConfig.update({
        where: { id: input.configId },
        data: { last_checked_at: new Date(), next_check_at: input.nextCheckAt },
    })
}
