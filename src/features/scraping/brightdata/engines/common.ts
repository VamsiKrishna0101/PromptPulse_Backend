import type { BrightDataInputPayload, BuildBrightDataInputParams } from "../types"

export function buildBaseInput(params: BuildBrightDataInputParams): BrightDataInputPayload {
    return {
        url: params.url,
        prompt: params.prompt.slice(0, Number(process.env.BRIGHT_DATA_MAX_PROMPT_CHARS ?? 4096)),
    }
}

export function buildIndexedInput(params: BuildBrightDataInputParams): BrightDataInputPayload {
    return {
        ...buildBaseInput(params),
        index: params.index,
    }
}
