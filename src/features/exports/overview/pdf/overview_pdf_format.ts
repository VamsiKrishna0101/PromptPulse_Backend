import type { OverviewMetric } from "../overview_export_types"
import { pdfText } from "../overview_export_pdf_primitives"

export function overviewDateLabel(date: Date) {
    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    })
}

export function overviewMetricValue(metric: OverviewMetric) {
    if (metric.format === "percent") return `${metric.value.toFixed(1)}%`
    if (metric.format === "position") return metric.value ? `#${metric.value.toFixed(1)}` : "-"
    if (metric.format === "score") return metric.value ? metric.value.toFixed(1) : "-"
    return metric.value.toLocaleString("en-US")
}

export function overviewDeltaLabel(metric: OverviewMetric) {
    if (metric.delta === null) return "No comparison"
    const favorable = metric.lowerIsBetter ? metric.delta <= 0 : metric.delta >= 0
    const sign = metric.delta > 0 ? "+" : ""
    return `${sign}${metric.delta.toFixed(1)} pts | ${favorable ? "Positive" : "Watch"}`
}

export function overviewShorten(value: string, length: number) {
    const clean = pdfText(value)
    return clean.length > length ? `${clean.slice(0, Math.max(1, length - 3)).trim()}...` : clean
}
