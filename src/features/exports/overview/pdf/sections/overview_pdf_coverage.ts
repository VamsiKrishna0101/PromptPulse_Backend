import type { OverviewExportModel } from "../../overview_export_types"
import { OVERVIEW_PDF as C } from "../../overview_export_theme"
import { addPageHeader, addSectionTitle, drawMetricCard, drawTable, pdfText } from "../../overview_export_pdf_primitives"
import { overviewDateLabel } from "../overview_pdf_format"

export function renderOverviewCoverage(doc: PDFKit.PDFDocument, model: OverviewExportModel) {
    addPageHeader(doc, model.brandName, "Data coverage and reliability")
    let y = 92
    const cards = [
        ["Prompts represented", model.coverage.representedPrompts, "Included response set"],
        ["Currently active", model.coverage.activePrompts, "Active project prompts"],
        ["Responses", model.coverage.responses, "Included after filters"],
        ["Successful runs", model.coverage.successfulRuns, "Completed visibility runs"],
        ["Partial runs", model.coverage.partialRuns, "Completed with some gaps"],
        ["Failed jobs", model.coverage.failedJobs, "Checks requiring review"],
    ] as const
    cards.forEach((item, index) => drawMetricCard({
        doc,
        x: 42 + (index % 3) * 174,
        y: y + Math.floor(index / 3) * 94,
        width: 164,
        label: item[0],
        value: item[1].toLocaleString("en-US"),
        detail: item[2],
        accent: item[0].includes("Failed") ? "#F59E0B" : C.sky,
    }))
    y += 214
    y = addSectionTitle(doc, "Coverage window", y)
    drawTable({
        doc,
        y,
        headers: ["Selected period", "First response", "Last response", "Comparison"],
        widths: [132, 132, 132, 115],
        rows: [[
            model.periodLabel,
            model.coverage.firstResponseAt ? overviewDateLabel(model.coverage.firstResponseAt) : "Unavailable",
            model.coverage.lastResponseAt ? overviewDateLabel(model.coverage.lastResponseAt) : "Unavailable",
            model.comparisonLabel ?? "Not available",
        ]],
    })
    y += 84
    y = addSectionTitle(doc, "How to interpret this report", y)
    model.methodology.slice(0, 6).forEach((item, index) => {
        doc.circle(48, y + 5, 2).fill(index < 2 ? C.blue : C.sky)
        doc.fillColor(C.text).font("Helvetica").fontSize(8.8)
            .text(pdfText(item), 58, y, { width: doc.page.width - 105, lineGap: 2 })
        y += 38
    })
}
