import fs from "fs"
import path from "path"
import dotenv from "dotenv"

/**
 * Voice AI Configuration & Environment Resolver
 */

export interface VoiceEnvConfig {
    groqApiKey: string | null
    geminiApiKey: string | null
    azureSpeechKey: string | null
    azureSpeechRegion: string
    exotelSid: string | null
    exotelApiKey: string | null
    exotelApiToken: string | null
    exotelCallerId: string
    isSimulationMode: boolean
    traiRestricted: boolean
}

export function getVoiceConfig(): VoiceEnvConfig {
    let groqKey = process.env.GROQ_API_KEY?.trim() || null
    let geminiKey = process.env.GEMINI_API_KEY?.trim() || null
    let azureKey = process.env.AZURE_SPEECH_KEY?.trim() || null
    let azureRegion = process.env.AZURE_SPEECH_REGION?.trim() || "centralindia"
    let traiRestricted = process.env.TRAI_RESTRICTION_ENABLED !== "false"

    // Fallback: Read from voice-ai/.env if not present in main backend env
    if (!groqKey || !azureKey) {
        try {
            const voiceAiEnvPath = path.resolve(process.cwd(), "..", "voice-ai", ".env")
            const localVoiceEnv = path.resolve(process.cwd(), "voice-ai", ".env")
            const envFile = fs.existsSync(voiceAiEnvPath) ? voiceAiEnvPath : fs.existsSync(localVoiceEnv) ? localVoiceEnv : null
            if (envFile) {
                const parsed = dotenv.parse(fs.readFileSync(envFile))
                groqKey = groqKey || parsed.GROQ_API_KEY || null
                azureKey = azureKey || parsed.AZURE_SPEECH_KEY || null
                azureRegion = azureRegion || parsed.AZURE_SPEECH_REGION || "centralindia"
                if (parsed.TRAI_RESTRICTION_ENABLED === "false") {
                    traiRestricted = false
                }
            }
        } catch {
            // Ignore error
        }
    }

    const exotelSid = process.env.EXOTEL_ACCOUNT_SID?.trim() || null
    const exotelApiKey = process.env.EXOTEL_API_KEY?.trim() || null
    const exotelApiToken = process.env.EXOTEL_API_TOKEN?.trim() || null
    const exotelCallerId = process.env.EXOTEL_CALLER_ID?.trim() || "+918045678900"

    const isSimulationMode = !exotelSid || !exotelApiKey

    return {
        groqApiKey: groqKey,
        geminiApiKey: geminiKey,
        azureSpeechKey: azureKey,
        azureSpeechRegion: azureRegion,
        exotelSid,
        exotelApiKey,
        exotelApiToken,
        exotelCallerId,
        isSimulationMode,
        traiRestricted,
    }
}

