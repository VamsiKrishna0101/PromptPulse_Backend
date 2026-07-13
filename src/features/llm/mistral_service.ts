import { Mistral } from '@mistralai/mistralai'

const client = new Mistral({ apiKey: process.env.MISTRAL_API_KEY })

/**
 * Runs a given prompt against Mistral's flagship chat model (mistral-large-latest)
 * This simulates a real user asking Le Chat a question.
 * The resulting text should be passed to the Gemini analyzer to extract brand visibility data.
 */
export async function runMistralPrompt(promptText: string): Promise<string> {
    const chatResponse = await client.chat.complete({
        model: 'mistral-large-latest', // The model powering Mistral's chat interface
        messages: [{ role: 'user', content: promptText }]
    })

    const content = chatResponse.choices?.[0]?.message?.content
    
    if (typeof content !== 'string') {
        throw new Error('Failed to get a string response from Mistral')
    }

    return content
}
