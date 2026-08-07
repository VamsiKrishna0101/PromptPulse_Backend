import prisma from "../../../lib/prisma"
import { dispatchVoiceCall } from "./voice_telephony_service"
import { VOICE_PLAYBOOKS } from "./voice_playbooks"
import { getVoiceConfig } from "./voice_config"
import type { VoicePlaybookType } from "./voice_types"

/**
 * Checks if current time in India (IST) is within 09:00 AM to 06:00 PM (18:00)
 */
export function isWithinCallingHoursIST(): { allowed: boolean; currentIST: string; message?: string } {
    const now = new Date()
    const istString = now.toLocaleTimeString("en-US", { timeZone: "Asia/Kolkata", hour12: false })
    const [hourStr, minStr] = istString.split(":")
    const currentHour = parseInt(hourStr, 10)
    const currentMin = parseInt(minStr, 10)
    const timeInMinutes = currentHour * 60 + currentMin

    const startMinutes = 9 * 60 // 09:00 AM
    const endMinutes = 18 * 60 // 06:00 PM

    const formattedTime = `${hourStr}:${minStr} IST`
    const config = getVoiceConfig()

    if (!config.traiRestricted || (timeInMinutes >= startMinutes && timeInMinutes <= endMinutes)) {
        return { allowed: true, currentIST: formattedTime }
    }

    return {
        allowed: false,
        currentIST: formattedTime,
        message: `Currently ${formattedTime}. Calling is permitted strictly between 09:00 AM and 06:00 PM IST under TRAI regulations.`,
    }
}

/**
 * Processes a batch of queued calls for an active campaign with concurrency limiting
 */
export async function processVoiceCampaignBatch(campaignId: string): Promise<void> {
    const campaign = await prisma.voiceCampaign.findUnique({
        where: { id: campaignId },
        include: { agent: true },
    })

    if (!campaign || campaign.status === "COMPLETED" || campaign.status === "PAUSED") {
        return
    }

    // Step 1: Check TRAI IST Calling Hours
    const timeCheck = isWithinCallingHoursIST()
    if (!timeCheck.allowed) {
        await prisma.voiceCampaign.update({
            where: { id: campaignId },
            data: {
                status: "PAUSED_TIME_WINDOW",
            },
        })
        console.log(`[voice_worker_queue] Campaign ${campaignId} paused: outside calling hours (${timeCheck.currentIST})`)
        return
    }

    // Step 2: Fetch queued records up to concurrent limit (e.g. 10)
    const concurrency = campaign.concurrent_limit || 10
    const queuedRecords = await prisma.voiceCallRecord.findMany({
        where: { campaign_id: campaignId, status: "QUEUED" },
        take: concurrency,
    })

    if (queuedRecords.length === 0) {
        // Check if any remaining in progress
        const remainingInProgress = await prisma.voiceCallRecord.count({
            where: { campaign_id: campaignId, status: { in: ["RINGING", "IN_PROGRESS"] } },
        })
        if (remainingInProgress === 0) {
            await prisma.voiceCampaign.update({
                where: { id: campaignId },
                data: {
                    status: "COMPLETED",
                    completed_at: new Date(),
                },
            })
        }
        return
    }

    // Step 3: Mark campaign as IN_PROGRESS
    await prisma.voiceCampaign.update({
        where: { id: campaignId },
        data: { status: "IN_PROGRESS", started_at: campaign.started_at || new Date() },
    })

    const playbook = VOICE_PLAYBOOKS[campaign.playbook_type as VoicePlaybookType] || VOICE_PLAYBOOKS.OPD_APPOINTMENT_CONFIRMATION

    // Step 4: Process records in parallel matching concurrency throttle
    await Promise.all(
        queuedRecords.map(async (record) => {
            try {
                // Update status to IN_PROGRESS
                await prisma.voiceCallRecord.update({
                    where: { id: record.id },
                    data: { status: "IN_PROGRESS" },
                })

                // Dispatch call
                const result = await dispatchVoiceCall({
                    recipient: {
                        name: record.patient_name,
                        phone: record.patient_phone,
                        doctor_name: record.doctor_name || undefined,
                        scheduled_slot: record.scheduled_slot || undefined,
                    },
                    playbook,
                    customPrompt: campaign.agent?.system_prompt,
                    liveTransferNumber: campaign.agent?.live_transfer_number || undefined,
                })

                // Save call outcome
                await prisma.voiceCallRecord.update({
                    where: { id: record.id },
                    data: {
                        status: result.status,
                        outcome_intent: result.outcome_intent,
                        duration_seconds: result.duration_seconds,
                        ai_summary: result.ai_summary,
                        transcript: result.transcript as any,
                        is_urgent: result.is_urgent,
                    },
                })
            } catch (err) {
                console.error(`[voice_worker_queue] Call failed for record ${record.id}:`, err)
                await prisma.voiceCallRecord.update({
                    where: { id: record.id },
                    data: { status: "FAILED" },
                })
            }
        })
    )

    // Step 5: Recalculate campaign aggregate totals
    const counts = await prisma.voiceCallRecord.groupBy({
        by: ["outcome_intent", "status"],
        where: { campaign_id: campaignId },
        _count: { id: true },
    })

    let calledCount = 0
    let confirmedCount = 0
    let rescheduledCount = 0
    let cancelledCount = 0
    let urgentCount = 0
    let failedCount = 0

    for (const c of counts) {
        if (c.status === "COMPLETED" || c.status === "FAILED") {
            calledCount += c._count.id
        }
        if (c.outcome_intent === "CONFIRMED") confirmedCount += c._count.id
        if (c.outcome_intent === "RESCHEDULED") rescheduledCount += c._count.id
        if (c.outcome_intent === "CANCELLED") cancelledCount += c._count.id
        if (c.outcome_intent === "URGENT_EMERGENCY_ESCALATION") urgentCount += c._count.id
        if (c.status === "FAILED") failedCount += c._count.id
    }

    await prisma.voiceCampaign.update({
        where: { id: campaignId },
        data: {
            called_count: calledCount,
            confirmed_count: confirmedCount,
            rescheduled_count: rescheduledCount,
            cancelled_count: cancelledCount,
            urgent_count: urgentCount,
            failed_count: failedCount,
        },
    })
}
