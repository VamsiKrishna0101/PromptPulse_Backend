import type { OverviewExportModel } from "../../overview_export_types"
import { OVERVIEW_PDF as C } from "../../overview_export_theme"
import { addPageHeader, pdfText } from "../../overview_export_pdf_primitives"
import { overviewShorten } from "../overview_pdf_format"

export function renderOverviewActions(doc: PDFKit.PDFDocument, model: OverviewExportModel) {
    addPageHeader(doc, model.brandName, "Prioritized action plan")
    let y = 92
    doc.fillColor(C.text).font("Helvetica").fontSize(9.5)
        .text("A practical 30/60/90-day roadmap built from measured prompt, engine, competitor, and source evidence.", 42, y, { width: 500 })
    y += 42

    const horizonLabel = { NOW: "0-30 DAYS", NEXT: "31-60 DAYS", LATER: "61-90 DAYS" } as const
    for (const item of model.actions.slice(0, 6)) {
        const height = 104
        doc.roundedRect(42, y, 511, height, 8).fillAndStroke(C.white, C.border)
        doc.roundedRect(56, y + 14, 68, 18, 5).fill(item.priority === "HIGH" ? C.navy : C.softBlue)
        doc.fillColor(item.priority === "HIGH" ? C.white : C.blue).font("Helvetica-Bold").fontSize(7)
            .text(item.priority, 56, y + 20, { width: 68, align: "center" })
        doc.fillColor(C.blue).font("Helvetica-Bold").fontSize(7)
            .text(horizonLabel[item.horizon], 134, y + 20)
        doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10)
            .text(overviewShorten(item.title, 62), 56, y + 42, { width: 472, height: 14, ellipsis: true })
        doc.fillColor(C.text).font("Helvetica").fontSize(8.3)
            .text(pdfText(item.action), 56, y + 61, { width: 300, height: 35, ellipsis: true, lineGap: 2 })
        doc.fillColor(C.muted).font("Helvetica").fontSize(7.8)
            .text(pdfText(item.evidence), 374, y + 61, { width: 154, height: 34, ellipsis: true, lineGap: 2 })
        y += height + 10
    }
}
