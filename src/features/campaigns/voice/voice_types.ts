/**
 * Voice AI Campaign Engine Types
 */

export type VoicePlaybookType =
    | "OPD_APPOINTMENT_CONFIRMATION"
    | "POST_DISCHARGE_CARE"
    | "LAB_REPORT_ALERT"
    | "PREVENTIVE_HEALTH_CAMP"
    | "CUSTOM_OUTREACH"

export type VoiceCallStatus =
    | "QUEUED"
    | "RINGING"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "BUSY"
    | "NO_ANSWER"
    | "FAILED"

export type VoiceOutcomeIntent =
    | "CONFIRMED"
    | "RESCHEDULED"
    | "CANCELLED"
    | "URGENT_EMERGENCY_ESCALATION"
    | "CALLBACK_REQUESTED"
    | "NOT_INTERESTED"
    | "UNKNOWN"

export interface TranscriptTurn {
    sender: "ai" | "user" | "system"
    text: string
    timestamp: string
    intent?: VoiceOutcomeIntent
}

export interface VoiceRecipientRow {
    name: string
    phone: string
    doctor_name?: string
    scheduled_slot?: string
    notes?: string
    custom_vars?: Record<string, string>
}

export interface VoicePlaybookDefinition {
    id: VoicePlaybookType
    name: string
    badge: string
    category: "Healthcare" | "General Business"
    description: string
    objective: string
    defaultLanguage: "te-IN" | "hi-IN" | "en-IN"
    defaultVoice: string
    systemPrompt: string
    sampleDialogueTelugu: string
    sampleDialogueEnglish: string
    emergencyTriggers: string[]
    recommendedSlots: string[]
}

export interface CallSimulationResult {
    patient_name: string
    patient_phone: string
    doctor_name?: string
    scheduled_slot?: string
    status: VoiceCallStatus
    outcome_intent: VoiceOutcomeIntent
    duration_seconds: number
    ai_summary: string
    transcript: TranscriptTurn[]
    is_urgent: boolean
}
