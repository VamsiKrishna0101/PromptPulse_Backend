import type { OverviewExportModel } from "../../overview_export_types"
import { OVERVIEW_PDF as C } from "../../overview_export_theme"
import { addPageHeader, addSectionTitle, drawMetricCard, pdfText } from "../../overview_export_pdf_primitives"
import { overviewDeltaLabel, overviewMetricValue } from "../overview_pdf_format"

export function renderOverviewExecutive(doc: PDFKit.PDFDocument, model: OverviewExportModel) {
    addPageHeader(doc, model.brandName, "Executive summary")
    let y = 92
    doc.fillColor(C.muted).font("Helvetica").fontSize(8.5)
        .text(`${pdfText(model.periodLabel)}${model.comparisonLabel ? ` | Compared with ${pdfText(model.comparisonLabel).toLowerCase()}` : ""}`, 42, y)
    y += 23
    const cardWidth = 98
    model.metrics.slice(0, 5).forEach((item, index) => drawMetricCard({
        doc,
        x: 42 + index * (cardWidth + 9),
        y,
        width: cardWidth,
        label: item.label,
        value: overviewMetricValue(item),
        detail: overviewDeltaLabel(item),
        accent: index === 1 ? C.mint : C.sky,
    }))
    y += 105
    doc.roundedRect(42, y, doc.page.width - 84, 76, 8).fill(C.softBlue)
    doc.fillColor(C.blue).font("Helvetica-Bold").fontSize(8).text("EXECUTIVE READOUT", 58, y + 15)
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(13)
        .text(pdfText(model.executiveHeadline), 58, y + 34, { width: doc.page.width - 116, lineGap: 3 })
    y += 100
    y = addSectionTitle(doc, "What leadership should know", y)
    model.executivePoints.slice(0, 4).forEach((item, index) => {
        doc.circle(52, y + 7, 7).fill(index === 0 ? C.navy : C.softBlue)
        doc.fillColor(index === 0 ? C.white : C.blue).font("Helvetica-Bold").fontSize(7)
            .text(String(index + 1), 48, y + 3.5, { width: 8, align: "center" })
        doc.fillColor(C.text).font("Helvetica").fontSize(9.5)
            .text(pdfText(item), 70, y, { width: doc.page.width - 118, lineGap: 2 })
        y += 38
    })

    y += 8
    y = addSectionTitle(doc, "Measured sentiment mix", y)
    const sentiment = model.sentiment
    const total = Math.max(1, sentiment.scoredResponses)
    const segments = [
        { label: "Positive", value: sentiment.positive, color: "#10B981" },
        { label: "Neutral", value: sentiment.neutral, color: C.sky },
        { label: "Negative", value: sentiment.negative, color: "#F59E0B" },
    ]
    let x = 42
    for (const segment of segments) {
        const width = 511 * (segment.value / total)
        if (width > 0) doc.rect(x, y, width, 16).fill(segment.color)
        x += width
    }
    y += 27
    segments.forEach((segment, index) => {
        doc.circle(48 + index * 150, y + 4, 3).fill(segment.color)
        doc.fillColor(C.text).font("Helvetica").fontSize(8.5)
            .text(`${segment.label}: ${segment.value}`, 57 + index * 150, y)
    })
}
