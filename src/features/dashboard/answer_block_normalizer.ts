export type AnswerBlock =
    | { type: "heading"; text: string; level: 2 | 3 }
    | { type: "paragraph"; text: string }
    | { type: "list"; items: string[] }
    | { type: "comparison"; headers: string[]; rows: string[][] }

const JUNK_LINE_PATTERNS = [
    /^videos?$/i,
    /^view all$/i,
    /^sponsored results?$/i,
    /^more results?/i,
    /^web results?$/i,
    /^related searches?/i,
    /^people also ask/i,
    /^find related/i,
    /^hide sponsored/i,
    /^youtube\s*[.-]/i,
    /^\d+:\d+$/,
    /^\d+ (days?|weeks?|months?) ago$/i,
    /^https?:\/\//i,
    /^\d+ (comments?|posts?|reactions?)$/i,
    /^\+\d+$/,
    /^-?\d+$/,
    /^(read ?more|show ?more)$/i,
]

const SECTION_HINTS = [
    /^recommendations?$/i,
    /^enterprise$/i,
    /^mid-market$/i,
    /^startups?$/i,
    /^best picks?$/i,
    /^best platform types?$/i,
    /^best picks by use case$/i,
    /^quick recommendations?$/i,
    /^key features/i,
    /^key takeaways?$/i,
    /^summary$/i,
    /^overview$/i,
    /^conclusion$/i,
    /^top \d+/i,
    /^best \w+/i,
    /^if you/i,
    /^my shortlist$/i,
]

const LEGACY_HEADER_HINTS = [
    "platform best for strengths potential limitations",
    "platform best fit why",
    "platform best for why",
    "tool use case strengths",
    "tool best for why",
    "tool best for why it stands out",
    "solution strengths limitations",
    "platform strengths limitations",
    "tool description best for",
    "platform description use case",
]

function compactWhitespace(value: string) {
    return value.replace(/\s+/g, " ").trim()
}

function cleanLine(value: string) {
    return value
        .replace(/^[*\-\u2013\u2022]\s*/, "")
        .replace(/^\d+\.\s*/, "")
        .replace(/\*\*/g, "")
        .replace(/^#{1,4}\s+/, "")
        .trim()
}

function isCitationMarker(line: string) {
    return /^\+\d+$|^[¹²³⁴⁵⁶⁷⁸⁹⁰]+$/.test(line.trim())
}

function isJunkLine(line: string) {
    return JUNK_LINE_PATTERNS.some(pattern => pattern.test(line.trim()))
}

function isSourceLabelArtifact(line: string) {
    return /^[a-z0-9][a-z0-9.-]{2,40}$/i.test(line.trim()) && !line.includes(" ")
}

function isLikelyHeading(line: string) {
    const clean = cleanLine(line)
    if (!clean || clean.length > 90) return false
    if (clean.endsWith(".") || clean.endsWith(",")) return false
    if (SECTION_HINTS.some(pattern => pattern.test(clean))) return true
    return /^[A-Z][A-Za-z0-9&+()/$\-\s]{2,70}$/.test(clean) && !/[,.]/.test(clean)
}

function isSentenceLike(line: string) {
    return /[.!?]$/.test(line) || line.includes(": ") || line.length > 72
}

function cleanCellText(cell: string) {
    return compactWhitespace(cell.replace(/\*\*/g, "").replace(/\*/g, "").replace(/`([^`]+)`/g, "$1"))
}

function isSeparatorRow(line: string) {
    return /^(\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim()) || /^(?::?-{2,}:?\s*\|\s*)+:?-{2,}:?$/.test(line.trim())
}

function parsePipeRow(line: string) {
    return line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(cleanCellText)
}

function tryParsePipeTable(lines: string[], startIndex: number): { headers: string[]; rows: string[][]; consumed: number } | null {
    const headerLine = lines[startIndex]
    const separatorLine = lines[startIndex + 1]
    if (!headerLine?.includes("|") || !separatorLine || !isSeparatorRow(separatorLine)) return null

    const headers = parsePipeRow(headerLine)
    const rows: string[][] = []
    let i = startIndex + 2

    while (i < lines.length && lines[i].includes("|") && !isLikelyHeading(lines[i])) {
        rows.push(parsePipeRow(lines[i]))
        i += 1
    }

    if (headers.length < 2 || rows.length === 0) return null
    return { headers, rows, consumed: i - startIndex }
}

function splitTabRow(line: string): string[] | null {
    if (line.includes("\t")) {
        const parts = line.split("\t").map(cleanCellText).filter(Boolean)
        if (parts.length >= 2) return parts
    }

    const parts = line.split(/\s{3,}/).map(cleanCellText).filter(Boolean)
    if (parts.length >= 2) return parts
    return null
}

function legacyHeaderMatch(line: string) {
    const normalized = line.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
    return LEGACY_HEADER_HINTS.some(header => normalized.includes(header))
}

function splitBrandRow(line: string, knownBrands: string[]) {
    const brand = knownBrands.find(item => line.toLowerCase().startsWith(`${item.toLowerCase()} `))
    if (!brand) return null

    const rest = compactWhitespace(line.slice(brand.length))
    if (!rest) return [brand, "", ""]

    const markers = [" Premium ", " Expensive ", " Best value ", " Requires ", " Best suited ", " More ", " Smaller ", " Usually ", " Limited "]
    const marker = markers
        .map(value => ({ value, index: rest.indexOf(value) }))
        .filter(item => item.index > 12)
        .sort((a, b) => a.index - b.index)[0]

    if (!marker) return [brand, rest, ""]
    return [brand, rest.slice(0, marker.index).trim(), rest.slice(marker.index).trim()]
}

function flushList(blocks: AnswerBlock[], listItems: string[]) {
    if (!listItems.length) return
    blocks.push({ type: "list", items: [...listItems] })
    listItems.length = 0
}

function flushParagraph(blocks: AnswerBlock[], paragraph: string[]) {
    if (!paragraph.length) return
    blocks.push({ type: "paragraph", text: compactWhitespace(paragraph.join(" ")) })
    paragraph.length = 0
}

function normalizeRawLines(raw: string) {
    const rawLines = raw.replace(/\r/g, "").split("\n")
    return rawLines
        .map((line, index) => {
            const trimmed = line.trim()
            if (!trimmed) return ""
            if (isJunkLine(trimmed)) return ""

            const previous = rawLines[index - 1]?.trim() ?? ""
            const next = rawLines[index + 1]?.trim() ?? ""
            if (isSourceLabelArtifact(trimmed) && (isCitationMarker(previous) || isCitationMarker(next))) return ""

            return trimmed
        })
        .filter(Boolean)
}

function normalizeRowWidth(row: string[], width: number) {
    if (row.length === width) return row
    if (row.length > width) return [...row.slice(0, width - 1), row.slice(width - 1).join(" ")]
    return [...row, ...Array.from({ length: width - row.length }, () => "")]
}

export function normalizeAnswerBlocks(raw: string, brands: string[] = []): AnswerBlock[] {
    if (!raw?.trim()) return [{ type: "paragraph", text: "" }]

    const lines = normalizeRawLines(raw)
    const knownBrands = [...new Set(brands.filter(Boolean))].sort((a, b) => b.length - a.length)
    const blocks: AnswerBlock[] = []
    const paragraph: string[] = []
    const listItems: string[] = []

    let index = 0
    while (index < lines.length) {
        const line = lines[index]

        const mdHeadingMatch = line.match(/^(#{1,4})\s+(.+)$/)
        if (mdHeadingMatch) {
            flushParagraph(blocks, paragraph)
            flushList(blocks, listItems)
            blocks.push({ type: "heading", level: mdHeadingMatch[1].length <= 2 ? 2 : 3, text: cleanLine(mdHeadingMatch[2]) })
            index += 1
            continue
        }

        const pipeTable = tryParsePipeTable(lines, index)
        if (pipeTable) {
            flushParagraph(blocks, paragraph)
            flushList(blocks, listItems)
            blocks.push({ type: "comparison", headers: pipeTable.headers, rows: pipeTable.rows.map(row => normalizeRowWidth(row, pipeTable.headers.length)) })
            index += pipeTable.consumed
            continue
        }

        const tabRow = splitTabRow(line)
        if (tabRow) {
            const tableRows: string[][] = [tabRow]
            let i = index + 1
            while (i < lines.length) {
                if (isSourceLabelArtifact(lines[i])) {
                    i += 1
                    continue
                }
                const nextRow = splitTabRow(lines[i])
                if (!nextRow) break
                tableRows.push(nextRow)
                i += 1
            }

            if (tableRows.length >= 2) {
                flushParagraph(blocks, paragraph)
                flushList(blocks, listItems)
                const headers = tableRows[0]
                blocks.push({
                    type: "comparison",
                    headers,
                    rows: tableRows.slice(1).map(row => normalizeRowWidth(row, headers.length)),
                })
                index = i
                continue
            }
        }

        if (legacyHeaderMatch(line)) {
            flushParagraph(blocks, paragraph)
            flushList(blocks, listItems)
            const rows: string[][] = []
            index += 1
            while (index < lines.length && !isLikelyHeading(lines[index])) {
                const row = splitTabRow(lines[index]) ?? splitBrandRow(cleanLine(lines[index]), knownBrands)
                if (row) rows.push(row)
                index += 1
            }
            if (rows.length) {
                blocks.push({ type: "comparison", headers: ["Tool", "Best for", "Why it stands out"], rows: rows.map(row => normalizeRowWidth(row, 3)) })
                continue
            }
        }

        const bulletMatch = line.match(/^[-*]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/)
        if (bulletMatch) {
            flushParagraph(blocks, paragraph)
            listItems.push(cleanLine(bulletMatch[1]))
            index += 1
            continue
        }

        const clean = cleanLine(line)
        if (isLikelyHeading(clean)) {
            flushParagraph(blocks, paragraph)
            flushList(blocks, listItems)
            blocks.push({ type: "heading", level: blocks.length === 0 ? 2 : 3, text: clean })
            index += 1
            continue
        }

        const next = lines[index + 1]
        const prevBlock = blocks[blocks.length - 1]
        const isStandaloneItem =
            clean.length <= 48 &&
            !isSentenceLike(clean) &&
            (prevBlock?.type === "heading" || listItems.length > 0 || Boolean(next && !isSentenceLike(next) && !isLikelyHeading(next)))

        if (isStandaloneItem) {
            flushParagraph(blocks, paragraph)
            listItems.push(clean)
            index += 1
            continue
        }

        flushList(blocks, listItems)
        paragraph.push(clean)
        index += 1
    }

    flushParagraph(blocks, paragraph)
    flushList(blocks, listItems)

    return blocks.length ? blocks : [{ type: "paragraph", text: compactWhitespace(raw) }]
}
