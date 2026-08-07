import { ScrapeJobStatus, VisibilityRunStatus } from "@prisma/client"
import prisma from "../../lib/prisma"

export async function refreshRunStatus(run_id: string) {
    const jobs = await prisma.scrapeJob.findMany({ where: { run_id } })
    const done = jobs.every(job => job.status !== ScrapeJobStatus.QUEUED && job.status !== ScrapeJobStatus.RUNNING)
    if (!done) return

    const successCount = jobs.filter(job => job.status === ScrapeJobStatus.SUCCESS).length
    const status = successCount === jobs.length
        ? VisibilityRunStatus.SUCCESS
        : successCount > 0
            ? VisibilityRunStatus.PARTIAL_SUCCESS
            : VisibilityRunStatus.FAILED

    await prisma.run.update({
        where: { id: run_id },
        data: {
            status,
            completed_at: new Date(),
        },
    })
    await import("../seo/onboarding/onboarding_service")
        .then(module => module.finalizeOnboardingVisibility(run_id))
        .catch(error => console.error("Could not finalize SEO onboarding visibility", error))
}
