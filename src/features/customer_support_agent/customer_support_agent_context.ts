import prisma from "../../lib/prisma"
import { PLAN_LIMITS, PLAN_PRICING } from "../subscription/plan_config"
import { getMyPlan } from "../subscription/subscription_service"
import type { SupportAgentContext } from "./customer_support_agent_types"

export async function buildCustomerSupportAgentContext(
    user_id: string,
    project_id?: string | null
): Promise<SupportAgentContext> {
    const [user, plan, recentTickets, selectedProject] = await Promise.all([
        prisma.user.findUnique({
            where: { id: user_id },
            select: {
                id: true,
                email: true,
                plan: true,
                created_at: true,
            },
        }),
        getMyPlan(user_id),
        prisma.helpCenter.findMany({
            where: { user_id },
            orderBy: { created_at: "desc" },
            take: 6,
            select: {
                id: true,
                subject: true,
                message: true,
                is_resolved: true,
                created_at: true,
            },
        }),
        project_id ? getProjectSupportContext(user_id, project_id) : getLatestProjectSupportContext(user_id),
    ])

    if (!user) {
        throw new Error("USER_NOT_FOUND")
    }

    return {
        user: {
            ...user,
            plan: plan.plan,
            effective_plan: plan.effective_plan,
        },
        subscription: {
            status: plan.status,
            current_period_start: plan.subscription?.current_period_start ?? null,
            current_period_end: plan.subscription?.current_period_end ?? null,
            trial_starts_at: plan.trial.starts_at,
            trial_ends_at: plan.trial.ends_at,
            trial_active: plan.trial.active,
            trial_days_left: plan.trial.days_left,
            cancel_at_period_end: Boolean(plan.subscription?.cancel_at_period_end),
        },
        limits: plan.limits,
        available_plans: buildAvailablePlans(),
        usage: {
            projects: plan.usage.project_count,
            prompts: plan.usage.prompt_count,
            competitors: plan.usage.competitor_count,
            credits_used: plan.usage.credits_used,
            credits_remaining: plan.usage.credits_remaining,
            monthly_runs_used: plan.usage.monthly_runs_used,
        },
        selected_project: selectedProject,
        recent_tickets: recentTickets,
    }
}

function buildAvailablePlans(): SupportAgentContext["available_plans"] {
    return (["FREE", "STARTER", "GROWTH", "PRO"] as const).map(id => ({
        id,
        ...PLAN_PRICING[id],
        limits: PLAN_LIMITS[id],
    }))
}

async function getLatestProjectSupportContext(user_id: string) {
    const project = await prisma.project.findFirst({
        where: { user_id },
        orderBy: { updated_at: "desc" },
        select: {
            id: true,
            brand_name: true,
            brand_url: true,
            brand_location: true,
            _count: {
                select: {
                    prompts: true,
                    competitors: true,
                    runs: true,
                },
            },
        },
    })

    if (!project) return null
    return attachJobCounts(project)
}

async function getProjectSupportContext(user_id: string, project_id: string) {
    const project = await prisma.project.findFirst({
        where: { id: project_id, user_id },
        select: {
            id: true,
            brand_name: true,
            brand_url: true,
            brand_location: true,
            _count: {
                select: {
                    prompts: true,
                    competitors: true,
                    runs: true,
                },
            },
        },
    })

    if (!project) {
        throw new Error("PROJECT_NOT_FOUND")
    }

    return attachJobCounts(project)
}

async function attachJobCounts(project: {
    id: string
    brand_name: string
    brand_url: string
    brand_location: string
    _count: {
        prompts: number
        competitors: number
        runs: number
    }
}) {
    const [failedJobs, queuedJobs, runningJobs] = await Promise.all([
        prisma.scrapeJob.count({ where: { project_id: project.id, status: "FAILED" } }),
        prisma.scrapeJob.count({ where: { project_id: project.id, status: "QUEUED" } }),
        prisma.scrapeJob.count({ where: { project_id: project.id, status: "RUNNING" } }),
    ])

    return {
        id: project.id,
        brand_name: project.brand_name,
        brand_url: project.brand_url,
        brand_location: project.brand_location,
        prompts: project._count.prompts,
        competitors: project._count.competitors,
        runs: project._count.runs,
        failed_jobs: failedJobs,
        queued_jobs: queuedJobs,
        running_jobs: runningJobs,
    }
}
