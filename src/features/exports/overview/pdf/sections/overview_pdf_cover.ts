import type { OverviewExportModel } from "../../overview_export_types"
import { OVERVIEW_PDF as C } from "../../overview_export_theme"
import { pdfText } from "../../overview_export_pdf_primitives"
import { overviewDateLabel } from "../overview_pdf_format"

export function renderOverviewCover(doc: PDFKit.PDFDocument, model: OverviewExportModel, logo: Buffer | null) {
    const { width, height } = doc.page
    doc.rect(0, 0, width, height).fill(C.navy)
    doc.circle(width + 8, 30, 160).fill(C.navySoft)
    doc.circle(width - 30, height - 20, 115).fill("#153B68")

    doc.roundedRect(48, 52, 62, 62, 13).fill(C.white)
    if (logo) {
        try {
            doc.image(logo, 61, 65, { fit: [36, 36], align: "center", valign: "center" })
        } catch {
            drawInitial(doc, model.brandName)
        }
    } else {
        drawInitial(doc, model.brandName)
    }

    doc.fillColor("#A8D8F5").font("Helvetica-Bold").fontSize(9)
        .text("AI VISIBILITY INTELLIGENCE REPORT", 48, 154, { characterSpacing: 1.5 })
    doc.fillColor(C.white).font("Helvetica-Bold").fontSize(31)
        .text(`${pdfText(model.brandName)} visibility report`, 48, 194, { width: width - 96, lineGap: 4 })
    doc.fillColor("#C6D7E9").font("Helvetica").fontSize(12)
        .text("Executive performance, buyer prompts, competitive position, source influence, and an evidence-led action plan.", 48, 280, { width: 430, lineGap: 4 })

    doc.roundedRect(48, 355, 210, 58, 8).fill("#102844")
    doc.fillColor("#8EBBE2").font("Helvetica-Bold").fontSize(7.5).text("REPORTING PERIOD", 64, 370)
    doc.fillColor(C.white).font("Helvetica-Bold").fontSize(14).text(pdfText(model.periodLabel), 64, 388)

    const visibility = model.metrics.find(item => item.label === "Brand visibility")
    doc.moveTo(48, height - 190).lineTo(width - 48, height - 190).strokeColor("#315478").lineWidth(0.7).stroke()
    doc.fillColor("#8EBBE2").font("Helvetica-Bold").fontSize(8).text("PREPARED FOR", 48, height - 158)
    doc.fillColor(C.white).font("Helvetica").fontSize(13).text(pdfText(model.brandName), 48, height - 137)
    doc.fillColor("#8EBBE2").font("Helvetica-Bold").fontSize(8).text("GENERATED", 300, height - 158)
    doc.fillColor(C.white).font("Helvetica").fontSize(11).text(overviewDateLabel(model.generatedAt), 300, height - 137)
    doc.fillColor(C.sky).font("Helvetica-Bold").fontSize(8).text("CURRENT VISIBILITY", 48, height - 86)
    doc.fillColor(C.white).font("Helvetica-Bold").fontSize(27)
        .text(`${(visibility?.value ?? 0).toFixed(1)}%`, 48, height - 62)
    doc.fillColor("#9CB6D0").font("Helvetica").fontSize(8)
        .text("Powered by PromptPulse", width - 180, height - 31, { width: 132, align: "right" })
}

function drawInitial(doc: PDFKit.PDFDocument, brandName: string) {
    doc.fillColor(C.navy).font("Helvetica-Bold").fontSize(23)
        .text(pdfText(brandName).slice(0, 1).toUpperCase(), 68, 70)
}
