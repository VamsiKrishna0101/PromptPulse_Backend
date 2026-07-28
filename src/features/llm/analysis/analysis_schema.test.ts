import assert from "node:assert/strict"
import { parseKimiAnalysisJson } from "./analysis_schema"

const result = parseKimiAnalysisJson(JSON.stringify({
    brand_mentioned: true,
    matched_brand_name: "BANDLA HOSPITALS",
    match_confidence: 0.99,
    brand_position: 1,
    sentiment_score: 75,
    brand_mentions: [{
        brand_name: "BANDLA HOSPITALS",
        canonical_brand_name: "Bandla Hospitals",
        domain: "bandlahospitals.in",
        entity_type: "TRACKED_BRAND",
        position: 1,
        sentiment_score: 75,
        evidence: "BANDLA HOSPITALS — 4.9",
    }],
    sources: [{
        url: "https://www.justdial.com/example",
        domain: "justdial.com",
        source_type: "EDITORIAL",
        is_cited: true,
    }],
}))

assert.equal(result.brand_mentioned, true)
assert.equal(result.matched_brand_name, "BANDLA HOSPITALS")
assert.equal(result.brand_mentions[0]?.entity_type, "TRACKED_BRAND")
assert.equal(result.brand_mentions[0]?.domain, "bandlahospitals.in")

assert.throws(() => parseKimiAnalysisJson(JSON.stringify({
    brand_mentioned: true,
    brand_position: 1,
    sentiment_score: 50,
    brand_mentions: [{
        brand_name: "Justdial",
        domain: "justdial.com",
        position: 1,
        sentiment_score: 50,
    }],
    sources: [],
})))

console.log("Kimi analysis schema regression checks passed.")
