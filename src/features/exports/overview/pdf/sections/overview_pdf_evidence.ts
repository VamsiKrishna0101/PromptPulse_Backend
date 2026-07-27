import type { OverviewExportModel } from "../../overview_export_types"
import { addPageHeader, drawTable } from "../../overview_export_pdf_primitives"
import { OVERVIEW_PDF as C } from "../../overview_export_theme"
import { overviewDateLabel, overviewShorten } from "../overview_pdf_format"

export function renderOverviewEvidence(doc: PDFKit.PDFDocument, model: OverviewExportModel) {
    addPageHeader(doc, model.brandName, "Response evidence appendix")
    let y = 92
    doc.fillColor(C.text).font("Helvetica").fontSize(9.5)
        .text("A compact audit trail of recent stored responses included in this report.", 42, y, { width: 500 })
    y += 42
    drawTable({
        doc,
        y,
        headers: ["Date", "Engine", "Prompt", "Mentioned", "Rank", "Sentiment", "Top source"],
        widths: [61, 62, 192, 55, 38, 51, 52],
        rows: model.evidence.slice(0, 12).map(row => [
            overviewDateLabel(row.date).replace(/ \d{4}$/, ""),
            row.engine,
            overviewShorten(row.prompt, 48),
            row.mentioned ? "Yes" : "No",
            row.position === null ? "-" : `#${row.position}`,
            row.sentiment === null ? "-" : row.sentiment.toFixed(0),
            overviewShorten(row.source || "-", 14),
        ]),
    })
}
