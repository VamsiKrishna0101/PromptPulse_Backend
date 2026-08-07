import { getVoiceConfig } from "./voice_config"

export interface SynthesizeOptions {
    text: string
    voiceName?: string // default "te-IN-ShrutiNeural"
    language?: string // default "te-IN"
    pitch?: string // "+0Hz"
    rate?: string // "+0%"
}

/**
 * Synthesizes natural Telugu speech using Microsoft Azure Cognitive Speech API
 */
export async function synthesizeTeluguVoiceAudio(options: SynthesizeOptions): Promise<{
    audioBuffer: Buffer
    contentType: string
    isLiveAzure: boolean
}> {
    const config = getVoiceConfig()
    const voice = options.voiceName || "te-IN-ShrutiNeural"
    const lang = options.language || "te-IN"
    const text = options.text.trim()

    // If Azure Speech Key is present, invoke Microsoft Cognitive Services REST API
    if (config.azureSpeechKey && config.azureSpeechRegion) {
        try {
            const ssml = `
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">
    <voice name="${voice}">
        <prosody rate="${options.rate || "+0%"}" pitch="${options.pitch || "+0Hz"}">
            ${escapeXml(text)}
        </prosody>
    </voice>
</speak>`.trim()

            const endpoint = `https://${config.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`

            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Ocp-Apim-Subscription-Key": config.azureSpeechKey,
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
                    "User-Agent": "CityCareVoiceAI/1.0",
                },
                body: ssml,
            })

            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer()
                return {
                    audioBuffer: Buffer.from(arrayBuffer),
                    contentType: "audio/mpeg",
                    isLiveAzure: true,
                }
            } else {
                console.warn(`[voice_speech_service] Azure Speech API error status ${response.status}: ${await response.text()}`)
            }
        } catch (azureErr) {
            console.error("[voice_speech_service] Azure Speech synthesis exception:", azureErr)
        }
    }

    // Fallback: Generate lightweight PCM/MP3 audio header representation for developer sandbox
    const fallbackBuffer = generateSyntheticAudioFallback(text)
    return {
        audioBuffer: fallbackBuffer,
        contentType: "audio/mpeg",
        isLiveAzure: false,
    }
}

function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case "<": return "&lt;"
            case ">": return "&gt;"
            case "&": return "&amp;"
            case "'": return "&apos;"
            case "\"": return "&quot;"
            default: return c
        }
    })
}

/**
 * Creates a minimal valid MP3 frame buffer for sandbox preview
 */
function generateSyntheticAudioFallback(text: string): Buffer {
    // 0.5s of silent/synthetic valid MP3 frames
    const mp3Header = Buffer.from([
        0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ])
    return Buffer.concat([mp3Header, Buffer.alloc(1024, 0)])
}
