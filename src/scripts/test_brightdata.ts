import "../lib/env"
import { runUiScrape } from "../features/scraping/scraper_api_client"
import type { UiEngine } from "../features/scraping/brightdata/types"

async function testEngine(engine: UiEngine) {
    console.log(`\n===========================================`)
    console.log(` Testing ${engine.toUpperCase()} via BrightData`)
    console.log(`===========================================`)
    
    const startTime = Date.now()
    try {
        const result = await runUiScrape({
            engine,
            prompt: "What is the best CRM software for small business?",
            geo: "US"
        })
        
        const elapsed = Date.now() - startTime
        
        const isSuccess = result.status === "success"
        console.log(`\n${isSuccess ? "✅" : "❌"} STATUS: ${result.status.toUpperCase()} (${elapsed}ms)`)
        console.log(`Model Label: ${result.model_label}`)
        console.log(`Error Reason: ${result.error_reason || "None"}`)
        console.log(`Answer Text Length: ${result.answer_text?.length || 0} chars`)
        
        if (result.answer_text) {
            console.log(`\n--- Answer Preview ---`)
            console.log(result.answer_text.slice(0, 300).trim() + "...")
            console.log(`----------------------`)
        }

        console.log(`\nCitations Extracted: ${result.citations.length}`)
        if (result.citations.length > 0) {
            result.citations.slice(0, 3).forEach((c, i) => {
                console.log(`  ${i + 1}. ${c.url}`)
            })
        }
        
        if (result.status !== "success" && result.raw_text) {
            console.log(`\n--- Raw JSON Dump ---`)
            console.log(result.raw_text.slice(0, 1000))
        }

    } catch (err: any) {
        console.error(`\n❌ EXCEPTION for ${engine}:`, err.message || err)
    }
}

async function main() {
    console.log("Starting BrightData direct API test...\n")
    
    // Disable API fallback so we see TRUE BrightData results, not LLM fallbacks
    process.env.SCRAPER_API_FALLBACK_ENABLED = "false"
    
    await testEngine("chatgpt")
    await testEngine("perplexity")
    
    console.log(`\n===========================================`)
    console.log(` Test Complete.`)
    console.log(`===========================================`)
    process.exit(0)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
