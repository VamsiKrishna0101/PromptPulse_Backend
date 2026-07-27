import type { OverviewExportModel } from "../../overview_export_types"
import { addPageHeader, addSectionTitle, drawTable, drawTrendChart } from "../../overview_export_pdf_primitives"

export function renderOverviewPerformance(doc: PDFKit.PDFDocument, model: OverviewExportModel) {
    addPageHeader(doc, model.brandName, "Visibility trend and AI engines")
    let y = 94
    y = addSectionTitle(doc, "Visibility over time", y)
    drawTrendChart({ doc, x: 42, y, width: doc.page.width - 84, height: 218, points: model.trend })
    y += 242
    y = addSectionTitle(doc, "Engine performance", y)
    drawTable({
        doc,
        y,
        headers: ["AI engine", "Responses", "Visibility", "Avg. position", "Sentiment", "Domains"],
        widths: [126, 72, 82, 88, 74, 69],
        rows: model.engines.slice(0, 8).map(row => [
            row.engine,
            String(row.responses),
            `${row.visibility.toFixed(1)}%`,
            row.position === null ? "-" : `#${row.position.toFixed(1)}`,
            row.sentiment === null ? "-" : row.sentiment.toFixed(1),
            String(row.sourceDomains),
        ]),
    })
}
