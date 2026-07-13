import 'dotenv/config'
import { analyzeResponse } from './gemini_service'

const BRAND_NAME = 'Nosferatu'
const BRAND_URL = 'https://en.wikipedia.org/wiki/Nosferatu'
const AI_MODEL = 'perplexity-ui'

const RAW_RESPONSE = `Absolutely - for old scary movies, I'd start with these classics because they still hold up for atmosphere, dread, and memorable scares.
collider
+1

Best old scary movies

Nosferatu (1922) - silent, creepy, and still one of the most iconic vampire films ever made.
collider

Diabolique (1955) - a slow-burn psychological horror that stays unsettling throughout.
collider

The Innocents (1961) - one of the best classic ghost stories, with strong atmosphere.
collider

Eyes Without a Face (1960) - eerie and disturbing, with a memorable medical-horror premise.
collider

Rosemary's Baby (1968) - a masterpiece of paranoia and slow-building dread.
collider
+1

The Texas Chain Saw Massacre (1974) - more brutal and intense, and still considered a landmark scare-fest.
collider

Onibaba (1964) - a haunting Japanese horror film with a very strong visual mood.
collider

Kwaidan (1964) - eerie, beautiful, and ideal if you want something more artistic but still creepy.
collider

If you want the scariest first

If your goal is to feel genuinely unsettled, the strongest picks are Rosemary's Baby, Nosferatu, The Innocents, and The Texas Chain Saw Massacre.
collider
+1

If you want something more classic and old-school, Diabolique and Eyes Without a Face are excellent choices.
collider

Easy watch order

Rosemary's Baby.

The Innocents.

Nosferatu.

Eyes Without a Face.

The Texas Chain Saw Massacre.

Diabolique.

Kwaidan.

Onibaba.

That order gives you a good mix of pure horror, psychological dread, and classic atmosphere.
collider
+1

Sources:
https://collider.com/horror-movies-over-50-years-old-still-scary/
https://collider.com/scariest-horror-movies-over-50-years-old-ranked/`

console.log(`Analyzing response for brand: "${BRAND_NAME}" from model: ${AI_MODEL}\n`)

const result = await analyzeResponse(RAW_RESPONSE, AI_MODEL, BRAND_NAME, BRAND_URL)

console.log('--- Brand Visibility ---')
console.log(`Mentioned: ${result.brand_mentioned}`)
console.log(`Position:  ${result.brand_position ?? 'N/A'}`)
console.log(`Sentiment: ${result.sentiment_score ?? 'N/A'}`)

console.log('\n--- Brands Found in Response ---')
result.brand_mentions.forEach((m, i) => {
    console.log(`[${i + 1}] ${m.brand_name} | Position: ${m.position ?? 'N/A'} | Sentiment: ${m.sentiment_score ?? 'N/A'}`)
})

console.log('\n--- Sources Detected ---')
result.sources.forEach((s, i) => {
    const formattedType = s.source_type === 'UGC' ? 'UGC' : s.source_type.charAt(0).toUpperCase() + s.source_type.slice(1).toLowerCase()
    console.log(`[${i + 1}] Domain: ${s.domain.padEnd(20)} | Type: ${formattedType.padEnd(12)} | Cited: ${s.is_cited} | URL: ${s.url}`)
})
