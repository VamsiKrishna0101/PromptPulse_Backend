import type { OverviewExportModel } from "../../overview_export_types"
import { OVERVIEW_PDF as C } from "../../overview_export_theme"
import { addPageHeader, addSectionTitle, drawMetricCard, drawTable, pdfText } from "../../overview_export_pdf_primitives"
import { overviewShorten } from "../overview_pdf_format"

export function renderOverviewSources(doc: PDFKit.PDFDocument, model: OverviewExportModel) {
    addPageHeader(doc, model.brandName, "Source influence and authority gaps")
    let y = 92
    const confirmed = model.sources.filter(source => source.brandPresence === "CONFIRMED").length
    const unconfirmed = model.sources.length - confirmed
    const summary = [
        ["Source domains", model.sources.length, C.sky],
        ["Brand confirmed", confirmed, C.mint],
        ["Presence gaps", unconfirmed, "#F59E0B"],
    ] as const
    summary.forEach((item, index) => drawMetricCard({
        doc,
        x: 42 + index * 174,
        y,
        width: 164,
        label: item[0],
        value: String(item[1]),
        detail: index === 2 ? "No structured brand confirmation" : "Measured source evidence",
        accent: item[2],
    }))
    y += 108
    y = addSectionTitle(doc, "Source mix", y)
    y = drawTable({
        doc,
        y,
        headers: ["Source type", "Domains", "Citations", "Brand confirmed"],
        widths: [230, 80, 92, 109],
        rows: model.sourceTypes.slice(0, 6).map(row => [
            row.sourceType,
            String(row.domains),
            String(row.citations),
            String(row.confirmedDomains),
        ]),
    })
    y += 28
    y = addSectionTitle(doc, "Highest-influence domains", y)
    const rows = model.sources.slice(0, 10)
    drawTable({
        doc,
        y,
        headers: ["#", "Domain", "Used", "Type", "Citations", "Brand"],
        widths: [30, 224, 57, 76, 60, 64],
        rows: rows.map(row => [
            String(row.rank),
            overviewShorten(row.domain, 34),
            `${row.usedPct.toFixed(1)}%`,
            row.sourceType,
            String(row.citations),
            row.brandPresence === "CONFIRMED" ? "Confirmed" : "Gap",
        ]),
        linkColumn: 1,
        links: rows.map(row => row.url),
    })
    const gap = model.sources.find(source => source.brandPresence === "NOT_CONFIRMED")
    if (gap) {
        const noteY = Math.min(doc.page.height - 105, y + 278)
        doc.roundedRect(42, noteY, 511, 48, 7).fill(C.softBlue)
        doc.fillColor(C.blue).font("Helvetica-Bold").fontSize(8).text("NEXT SOURCE MOVE", 56, noteY + 11)
        doc.fillColor(C.text).font("Helvetica").fontSize(8.5)
            .text(pdfText(`Prioritize ${gap.domain}: it appears in ${gap.usedPct.toFixed(1)}% of measured responses without confirmed brand presence.`), 56, noteY + 27, { width: 470 })
    }
}
