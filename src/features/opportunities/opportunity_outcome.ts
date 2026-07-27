export type RecommendationOutcome = "RECOMMENDED" | "LISTED" | "ABSENT" | "NEGATIVE"

export function recommendationOutcome(input: {
    visibility: number
    position: number | null
    sentiment: number | null
}): RecommendationOutcome {
    if (input.visibility <= 0) return "ABSENT"
    if (input.sentiment !== null && input.sentiment < 45) return "NEGATIVE"
    if (input.position !== null && input.position <= 2.5) return "RECOMMENDED"
    return "LISTED"
}

export function outcomeExplanation(outcome: RecommendationOutcome) {
    if (outcome === "RECOMMENDED") return "AI places the brand near the top of the answer."
    if (outcome === "LISTED") return "AI mentions the brand but does not strongly recommend it."
    if (outcome === "NEGATIVE") return "AI mentions the brand with weak or negative sentiment."
    return "AI does not include the brand in matching answers."
}

