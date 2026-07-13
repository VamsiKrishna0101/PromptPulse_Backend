import 'dotenv/config'
import { runMistralPrompt } from './mistral_service'

async function runTest() {
    console.log('Sending prompt to Mistral Le Chat (mistral-large-latest)...\n')

    const prompt = 'What are the top company intelligence platforms used for B2B sales in 2026? Keep it brief also list the sources u used to get the responses please.'

    console.log(`Prompt: "${prompt}"\n`)

    try {
        const response = await runMistralPrompt(prompt)
        console.log('--- Mistral Response ---')
        console.log(response)
        console.log('------------------------')
    } catch (error) {
        console.error('Error calling Mistral:', error)
    }
}

runTest()
