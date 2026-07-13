export type AnswerBlock =
    | { type: "heading"; text: string; level: 2 | 3 }
    | { type: "paragraph"; text: string }
    | { type: "list"; items: string[] }
    | { type: "comparison"; headers: string[]; rows: string[][] }

const SECTION_HINTS = [
    /^recommendations?\b/i,
    /^enterprise\b/i,
    /^mid-market\b/i,
    /^startup\b/i,
    /^revenue operations\b/i,
    /^account-based marketing/i,
    /^if you/i,
    /^my shortlist\b/i,
]

const TABLE_HEADER_HINTS = [
    "platform best for strengths potential limitations",
    "platform best fit why",
    "platform best for why",
]

function compactWhitespace(value: string) {
    return value.replace(/\s+/g, " ").trim()
}

function cleanLine(value: string) {
    return compactWhitespace(
        value
            .replace(/^[*-]\s*/, "")
            .replace(/^\d+\.\s*/, "")
            .replace(/\*\*/g, "")
    )
}

function isCitationMarker(line: string) {
    return /^\+\d+$/.test(line) || /^[¹²³⁴⁵⁶⁷⁸⁹⁰]+$/.test(line)
}

function isLikelyHeading(line: string) {
    if (!line || line.length > 90) return false
    if (line.endsWith(".") || line.endsWith(":")) return false
    if (SECTION_HINTS.some(pattern => pattern.test(line))) return true
    return /^[A-Z][A-Za-z0-9&+()/$\-\s]{2,}$/.test(line) && !/[,.]/.test(line)
}

function isSentenceLike(line: string) {
    return /[.!?]$/.test(line) || line.includes(": ") || line.length > 72
}

function normalizeLines(raw: string) {
    const lines = raw
        .replace(/\r/g, "")
        .split("\n")
        .map(cleanLine)
        .filter(Boolean)

    return lines.filter((line, index) => {
        if (isCitationMarker(line)) return false
        const next = lines[index + 1]
        const prev = lines[index - 1]
        if (next && isCitationMarker(next) && prev && isSentenceLike(prev) && line.length < 35) return false
        return true
    })
}

function tableHeaderIndex(line: string) {
    const normalized = line.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
    return TABLE_HEADER_HINTS.findIndex(header => normalized.includes(header))
}

function splitComparisonRow(line: string, knownBrands: string[]) {
    const brand = knownBrands.find(item => line.toLowerCase().startsWith(`${item.toLowerCase()} `))
    if (!brand) return null

    const rest = line.slice(brand.length).trim()
    if (!rest) return [brand, "", ""]

    const limitationMarkers = [
        " Premium ",
        " Expensive ",
        " Best value ",
        " Requires ",
        " Best suited ",
        " More ",
        " Smaller ",
        " Usually ",
        " Limited ",
    ]

    const marker = limitationMarkers
        .map(value => ({ value, index: rest.indexOf(value) }))
        .filter(item => item.index > 12)
        .sort((a, b) => a.index - b.index)[0]

    if (!marker) return [brand, rest, ""]

    return [
        brand,
        rest.slice(0, marker.index).trim(),
        rest.slice(marker.index).trim(),
    ]
}

function flushList(blocks: AnswerBlock[], listItems: string[]) {
    if (!listItems.length) return
    blocks.push({ type: "list", items: [...listItems] })
    listItems.length = 0
}

function flushParagraph(blocks: AnswerBlock[], paragraph: string[]) {
    if (!paragraph.length) return
    blocks.push({ type: "paragraph", text: paragraph.join(" ") })
    paragraph.length = 0
}

export function normalizeAnswerBlocks(raw: string, brands: string[] = []): AnswerBlock[] {
    const lines = normalizeLines(raw)
    const knownBrands = [...new Set(brands.filter(Boolean))].sort((a, b) => b.length - a.length)
    const blocks: AnswerBlock[] = []
    const paragraph: string[] = []
    const listItems: string[] = []

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]

        if (tableHeaderIndex(line) >= 0) {
            flushParagraph(blocks, paragraph)
            flushList(blocks, listItems)

            const rows: string[][] = []
            index += 1
            while (index < lines.length) {
                const candidate = lines[index]
                if (isLikelyHeading(candidate)) {
                    index -= 1
                    break
                }
                const row = splitComparisonRow(candidate, knownBrands)
                if (row) rows.push(row)
                index += 1
            }

            if (rows.length) {
                blocks.push({
                    type: "comparison",
                    headers: ["Platform", "Strengths", "Watch-outs"],
                    rows,
                })
            }
            continue
        }

        if (isLikelyHeading(line)) {
            flushParagraph(blocks, paragraph)
            flushList(blocks, listItems)
            blocks.push({ type: "heading", level: blocks.length === 0 ? 2 : 3, text: line })
            continue
        }

        const next = lines[index + 1]
        const prevBlock = blocks[blocks.length - 1]
        const isStandaloneItem =
            line.length <= 46 &&
            !isSentenceLike(line) &&
            (prevBlock?.type === "heading" || listItems.length > 0 || Boolean(next && !isSentenceLike(next) && !isLikelyHeading(next)))

        if (isStandaloneItem) {
            flushParagraph(blocks, paragraph)
            listItems.push(line)
            continue
        }

        flushList(blocks, listItems)
        paragraph.push(line)
    }

    flushParagraph(blocks, paragraph)
    flushList(blocks, listItems)

    return blocks.length ? blocks : [{ type: "paragraph", text: compactWhitespace(raw) }]
}
