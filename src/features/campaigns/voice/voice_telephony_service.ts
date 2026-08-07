import { getVoiceConfig } from "./voice_config"
import { executeVoiceBrainTurn } from "./voice_ai_brain"
import type { CallSimulationResult, TranscriptTurn, VoiceRecipientRow, VoicePlaybookDefinition } from "./voice_types"

/**
 * Initiates or simulates an outbound Voice AI call to a patient/customer
 */
export async function dispatchVoiceCall(params: {
    recipient: VoiceRecipientRow
    playbook: VoicePlaybookDefinition
    customPrompt?: string
    liveTransferNumber?: string
}): Promise<CallSimulationResult> {
    const { recipient, playbook, customPrompt, liveTransferNumber } = params
    const prompt = customPrompt || playbook.systemPrompt

    // Interpolate variables into prompt and initial greeting
    const interpolatedPrompt = prompt
        .replace(/{{patient_name}}/g, recipient.name)
        .replace(/{{doctor_name}}/g, recipient.doctor_name || "Doctor")
        .replace(/{{scheduled_slot}}/g, recipient.scheduled_slot || "Tomorrow 10:30 AM")

    const initialGreeting = `Namaste ${recipient.name} garu! City Care Hospital nunchi Shruti matladutunnanu. Repu ${recipient.scheduled_slot || "10:30 AM"} ki ${recipient.doctor_name || "Doctor"} tho mee appointment undi. Meeru vastunnara?`

    const transcript: TranscriptTurn[] = [
        {
            sender: "ai",
            text: initialGreeting,
            timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
        },
    ]

    // Simulate natural patient responses based on realistic probability distributions
    const sampleResponses = [
        "Ha vastanu amma, repu 10:30 ki correct time ki untanu.",
        "Avunu vastanu, consultation fee entha untundi?",
        "Ledu amma repu naaku vere work undi, Friday roju change cheyyandi.",
        "Nenu repu ralenandi, weekend morning slot unda?",
        "Avunu vastanu kani naku sudden ga chest pain vasthundi, doctor available unnara?",
        "Vaddu amma nenu veredaggara chupinchukunnanu, appointment cancel cheyyandi.",
    ]

    // Choose utterance based on recipient name / deterministic pseudo-hash
    const hash = recipient.name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const patientUtterance = sampleResponses[hash % sampleResponses.length]

    transcript.push({
        sender: "user",
        text: patientUtterance,
        timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
    })

    // Run Voice AI Brain Turn
    const brainTurn = await executeVoiceBrainTurn({
        systemPrompt: interpolatedPrompt,
        patientName: recipient.name,
        doctorName: recipient.doctor_name,
        slot: recipient.scheduled_slot,
        transcript,
        latestPatientUtterance: patientUtterance,
        emergencyKeywords: playbook.emergencyTriggers,
    })

    transcript.push({
        sender: "ai",
        text: brainTurn.replyText,
        timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
        intent: brainTurn.intent,
    })

    // If emergency escalated, add transfer log
    if (brainTurn.isUrgent) {
        transcript.push({
            sender: "system",
            text: `[EMERGENCY ESCALATION] Call routed immediately to Hospital Emergency Desk ${liveTransferNumber || "+91 80 4567 8911"}.`,
            timestamp: new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" }),
        })
    }

    // Realistic call duration between 35s and 65s
    const duration = 30 + (hash % 35)

    return {
        patient_name: recipient.name,
        patient_phone: recipient.phone,
        doctor_name: recipient.doctor_name || "Dr. Priya Sharma",
        scheduled_slot: recipient.scheduled_slot || "Tomorrow 10:30 AM",
        status: "COMPLETED",
        outcome_intent: brainTurn.intent,
        duration_seconds: duration,
        ai_summary: brainTurn.summary,
        transcript,
        is_urgent: brainTurn.isUrgent,
    }
}
