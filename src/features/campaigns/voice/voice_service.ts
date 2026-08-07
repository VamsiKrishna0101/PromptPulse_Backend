import prisma from "../../../lib/prisma"
import { VOICE_PLAYBOOKS } from "./voice_playbooks"
import { processVoiceCampaignBatch } from "./voice_worker_queue"
import type { VoicePlaybookType, VoiceRecipientRow } from "./voice_types"

/**
 * Ensures a VoiceAccount exists for the given project
 */
export async function getOrCreateVoiceAccount(projectId: string, userId: string) {
    let account = await prisma.voiceAccount.findUnique({
        where: { project_id: projectId },
        include: { agents: true },
    })

    if (!account) {
        account = await prisma.voiceAccount.create({
            data: {
                project_id: projectId,
                user_id: userId,
                provider: "AZURE_EXOTEL",
                caller_id: "+91 80 4567 8900",
                agents: {
                    create: {
                        name: "Telugu Hospital Receptionist (Shruti)",
                        playbook_type: "OPD_APPOINTMENT_CONFIRMATION",
                        language: "te-IN",
                        voice_name: "te-IN-ShrutiNeural",
                        system_prompt: VOICE_PLAYBOOKS.OPD_APPOINTMENT_CONFIRMATION.systemPrompt,
                        emergency_keywords: VOICE_PLAYBOOKS.OPD_APPOINTMENT_CONFIRMATION.emergencyTriggers,
                        live_transfer_number: "+91 80 4567 8911",
                    },
                },
            },
            include: { agents: true },
        })
    }

    return account
}

/**
 * Sanitizes Indian phone numbers into clean +91XXXXXXXXXX format
 */
export function sanitizeIndianPhone(raw: string): string {
    const cleaned = raw.replace(/[^0-9+]/g, "")
    if (cleaned.startsWith("+91") && cleaned.length === 13) return cleaned
    if (cleaned.startsWith("91") && cleaned.length === 12) return `+${cleaned}`
    if (cleaned.startsWith("0") && cleaned.length === 11) return `+91${cleaned.slice(1)}`
    if (cleaned.length === 10) return `+91${cleaned}`
    return cleaned.startsWith("+") ? cleaned : `+91${cleaned}`
}

/**
 * Parses raw CSV or text content into clean recipient objects
 */
export function parseRecipientCsv(csvText: string): VoiceRecipientRow[] {
    const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)

    if (lines.length === 0) return []

    const firstLine = lines[0].toLowerCase()
    const hasHeader = firstLine.includes("name") || firstLine.includes("phone") || firstLine.includes("number")
    const dataRows = hasHeader ? lines.slice(1) : lines

    const recipients: VoiceRecipientRow[] = []

    for (const row of dataRows) {
        // Split by comma or semicolon or tab
        const cols = row.split(/[,;\t]/).map((c) => c.trim().replace(/^["']|["']$/g, ""))
        if (cols.length < 2) continue

        const name = cols[0] || "Patient"
        const phone = sanitizeIndianPhone(cols[1])
        const doctor = cols[2] || "Dr. Priya Sharma"
        const slot = cols[3] || "Tomorrow 10:30 AM"
        const notes = cols[4] || ""

        if (phone.length >= 10) {
            recipients.push({
                name,
                phone,
                doctor_name: doctor,
                scheduled_slot: slot,
                notes,
            })
        }
    }

    return recipients
}

/**
 * Creates a new Voice Campaign and bulk-creates call records
 */
export async function createVoiceCampaign(params: {
    accountId: string
    agentId: string
    name: string
    playbookType: VoicePlaybookType
    recipients: VoiceRecipientRow[]
    concurrentLimit?: number
}) {
    const { accountId, agentId, name, playbookType, recipients, concurrentLimit = 10 } = params

    return prisma.$transaction(async (tx) => {
        const campaign = await tx.voiceCampaign.create({
            data: {
                account_id: accountId,
                agent_id: agentId,
                name,
                playbook_type: playbookType,
                status: "DRAFT",
                total_recipients: recipients.length,
                concurrent_limit: concurrentLimit,
            },
        })

        if (recipients.length > 0) {
            await tx.voiceCallRecord.createMany({
                data: recipients.map((r) => ({
                    campaign_id: campaign.id,
                    patient_name: r.name,
                    patient_phone: r.phone,
                    doctor_name: r.doctor_name,
                    scheduled_slot: r.scheduled_slot,
                    status: "QUEUED",
                })),
            })
        }

        return campaign
    })
}

/**
 * Launches an existing campaign and kicks off the background processor
 */
export async function launchVoiceCampaign(campaignId: string) {
    const campaign = await prisma.voiceCampaign.update({
        where: { id: campaignId },
        data: { status: "QUEUED" },
    })

    // Kick off worker asynchronously
    setImmediate(async () => {
        try {
            await processVoiceCampaignBatch(campaignId)
        } catch (err) {
            console.error(`[voice_service] Background campaign launch error for ${campaignId}:`, err)
        }
    })

    return campaign
}
