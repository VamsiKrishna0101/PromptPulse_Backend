import crypto from "node:crypto"
import { Plan } from "@prisma/client"
import prisma from "../../lib/prisma"
import { createPdfExport } from "../exports/export_service"
import { sendEmail } from "./email_service"

type WeeklyReportStatus = "GENERATING" | "SENT" | "FAILED" | "SKIPPED"

type WeeklyReportResult = {
    user_id: string
    project_id: string
    email: string
    brand_name: string
    status: WeeklyReportStatus
    reason?: string
}

type SendWeeklyReportsInput = {
    targetEmail?: string
    force?: boolean
}

const PAID_WEEKLY_REPORT_PLANS = new Set<Plan>([Plan.STARTER, Plan.GROWTH, Plan.PRO])

function getWeeklyPeriod(referenceDate = new Date()) {
    const periodEnd = new Date(referenceDate)
    periodEnd.setMilliseconds(0)
    periodEnd.setSeconds(0)
    periodEnd.setMinutes(0)

    const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
    return { periodStart, periodEnd }
}

export async function sendWeeklyEmailReports(input: SendWeeklyReportsInput = {}) {
    const { periodStart, periodEnd } = getWeeklyPeriod()
    const users = await prisma.user.findMany({
        where: {
            is_verified: true,
            ...(input.targetEmail ? { email: input.targetEmail.trim().toLowerCase() } : {}),
            plan: {
                in: Array.from(PAID_WEEKLY_REPORT_PLANS),
            },
            projects: {
                some: {},
            },
        },
        select: {
            id: true,
            email: true,
            plan: true,
            projects: {
                select: {
                    id: true,
                    brand_name: true,
                },
                orderBy: {
                    created_at: "asc",
                },
            },
        },
        orderBy: {
            created_at: "asc",
        },
    })

    const results: WeeklyReportResult[] = []

    for (const user of users) {
        for (const project of user.projects) {
            const result = await sendProjectWeeklyReport({
                userId: user.id,
                email: user.email,
                projectId: project.id,
                brandName: project.brand_name,
                periodStart,
                periodEnd,
                force: input.force ?? false,
            })
            results.push(result)
        }
    }

    return {
        period_start: periodStart,
        period_end: periodEnd,
        users_checked: users.length,
        reports: results,
    }
}

async function sendProjectWeeklyReport(input: {
    userId: string
    email: string
    projectId: string
    brandName: string
    periodStart: Date
    periodEnd: Date
    force: boolean
}): Promise<WeeklyReportResult> {
    const existing = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
        select id, status
        from "WeeklyEmailReport"
        where project_id = ${input.projectId}
          and period_start = ${input.periodStart}
          and period_end = ${input.periodEnd}
        limit 1
    `

    if (existing[0]?.status === "SENT" && !input.force) {
        return {
            user_id: input.userId,
            project_id: input.projectId,
            email: input.email,
            brand_name: input.brandName,
            status: "SKIPPED",
            reason: "Already sent for this weekly period",
        }
    }

    const reportId = existing[0]?.id ?? crypto.randomUUID()
    await upsertWeeklyReport({
        id: reportId,
        userId: input.userId,
        projectId: input.projectId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        status: "GENERATING",
    })

    try {
        const pdf = await createPdfExport({
            project_id: input.projectId,
            resource: "overview",
            filters: { days: 7 },
        })

        const response = await sendEmail({
            to: input.email,
            subject: `Your weekly PromptPulse report for ${input.brandName}`,
            text: `Your weekly PromptPulse AI visibility report for ${input.brandName} is attached.`,
            html: buildWeeklyReportEmailHtml({
                brandName: input.brandName,
                periodStart: input.periodStart,
                periodEnd: input.periodEnd,
            }),
            attachments: [{
                name: pdf.filename,
                content: pdf.content,
            }],
        })

        await prisma.$executeRaw`
            update "WeeklyEmailReport"
            set status = 'SENT',
                pdf_filename = ${pdf.filename},
                brevo_message_id = ${response?.messageId ?? null},
                error_reason = null,
                sent_at = now(),
                updated_at = now()
            where id = ${reportId}
        `

        return {
            user_id: input.userId,
            project_id: input.projectId,
            email: input.email,
            brand_name: input.brandName,
            status: "SENT",
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : "Weekly report failed"
        await prisma.$executeRaw`
            update "WeeklyEmailReport"
            set status = 'FAILED',
                error_reason = ${message},
                updated_at = now()
            where id = ${reportId}
        `

        return {
            user_id: input.userId,
            project_id: input.projectId,
            email: input.email,
            brand_name: input.brandName,
            status: "FAILED",
            reason: message,
        }
    }
}

async function upsertWeeklyReport(input: {
    id: string
    userId: string
    projectId: string
    periodStart: Date
    periodEnd: Date
    status: WeeklyReportStatus
}) {
    await prisma.$executeRaw`
        insert into "WeeklyEmailReport"
            (id, user_id, project_id, period_start, period_end, status, created_at, updated_at)
        values
            (${input.id}, ${input.userId}, ${input.projectId}, ${input.periodStart}, ${input.periodEnd}, ${input.status}, now(), now())
        on conflict (project_id, period_start, period_end)
        do update set
            status = ${input.status},
            error_reason = null,
            updated_at = now()
    `
}

function buildWeeklyReportEmailHtml(input: {
    brandName: string
    periodStart: Date
    periodEnd: Date
}) {
    const period = `${formatDate(input.periodStart)} - ${formatDate(input.periodEnd)}`

    return `
        <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:28px;color:#0f172a">
            <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
                <div style="background:#0f172a;color:white;padding:24px 28px">
                    <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#93c5fd">PromptPulse Weekly Report</p>
                    <h1 style="margin:0;font-size:24px;line-height:1.25">Your AI visibility report is ready</h1>
                </div>
                <div style="padding:26px 28px">
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#475569">
                        We prepared your 7-day AI visibility benchmark for <strong>${escapeHtml(input.brandName)}</strong>.
                    </p>
                    <div style="margin:0 0 20px;background:#f1f5f9;border:1px solid #dbe4ef;border-radius:14px;padding:16px">
                        <p style="margin:0;font-size:13px;color:#64748b">Report period</p>
                        <p style="margin:4px 0 0;font-size:16px;font-weight:800;color:#0f172a">${period}</p>
                    </div>
                    <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#475569">
                        The PDF is attached. Open PromptPulse to review prompts, source movement, competitors, and opportunities in more detail.
                    </p>
                    <a href="${process.env.FRONTEND_APP_URL ?? "http://localhost:5173/dashboard"}" style="display:inline-block;background:#0f172a;color:white;text-decoration:none;border-radius:12px;padding:12px 16px;font-size:13px;font-weight:800">Open dashboard</a>
                    <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#94a3b8">
                        You are receiving this because weekly email reports are enabled for your PromptPulse workspace.
                    </p>
                </div>
            </div>
        </div>
    `
}

function formatDate(value: Date) {
    return new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "2-digit",
    }).format(value)
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
}
