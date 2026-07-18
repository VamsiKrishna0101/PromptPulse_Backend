import type { InternalMcpSection } from "./types"

export function formatInternalMcpSections(sections: InternalMcpSection[]) {
    return sections
        .map(section => {
            const lines = section.lines
                .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
                .map(line => `- ${line}`)

            if (lines.length === 0) return ""
            return [`## ${section.title}`, ...lines].join("\n")
        })
        .filter(Boolean)
        .join("\n\n")
}

export function formatDate(value: Date | null | undefined) {
    return value ? value.toISOString() : "n/a"
}

export function formatNumber(value: number | null | undefined, digits = 1) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "n/a"
    return Number(value.toFixed(digits)).toString()
}

export function formatPercent(value: number | null | undefined, digits = 1) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "n/a"
    return `${formatNumber(value, digits)}%`
}

export function formatLimit(value: number | "unlimited") {
    return value === "unlimited" ? "unlimited" : value.toString()
}

export function compactList(values: string[], max = 8) {
    if (values.length <= max) return values.join(", ")
    return `${values.slice(0, max).join(", ")} +${values.length - max} more`
}
