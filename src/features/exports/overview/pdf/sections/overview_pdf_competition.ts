import type { OverviewExportModel } from "../../overview_export_types"
import { OVERVIEW_PDF as C } from "../../overview_export_theme"
import { addPageHeader, addSectionTitle, drawHorizontalBar, drawTable } from "../../overview_export_pdf_primitives"

export function renderOverviewCompetition(doc: PDFKit.PDFDocument, model: OverviewExportModel) {
    addPageHeader(doc, model.brandName, "Competitive landscape")
    let y = 92
    const own = model.brands.find(brand => brand.isOwnBrand)
    const strongest = model.brands.find(brand => !brand.isOwnBrand)
    if (own && strongest) {
        const gap = own.visibility - strongest.visibility
        doc.roundedRect(42, y, 511, 62, 8).fill(gap >= 0 ? C.softMint : "#FFF7ED")
        doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(11)
            .text(gap >= 0 ? `${model.brandName} leads ${strongest.brand}` : `${strongest.brand} leads ${model.brandName}`, 58, y + 15)
        doc.fillColor(C.text).font("Helvetica").fontSize(9)
            .text(`${Math.abs(gap).toFixed(1)} percentage points separate the two brands in measured AI visibility.`, 58, y + 36)
        y += 86
    }
    const max = Math.max(100, ...model.brands.map(item => item.visibility))
    model.brands.slice(0, 7).forEach((brand, index) => {
        drawHorizontalBar({
            doc,
            x: 42,
            y: y + index * 40,
            width: 511,
            label: `${brand.rank}. ${brand.brand}${brand.isOwnBrand ? " (tracked brand)" : ""}`,
            value: brand.visibility,
            max,
            suffix: "%",
            color: brand.isOwnBrand ? C.blue : C.sky,
        })
    })
    y += Math.min(7, model.brands.length) * 40 + 24
    y = addSectionTitle(doc, "Competitive benchmark", y)
    drawTable({
        doc,
        y,
        headers: ["#", "Brand", "Visibility", "Mentions", "Avg. position", "Sentiment"],
        widths: [34, 185, 79, 66, 84, 63],
        rows: model.brands.slice(0, 9).map(row => [
            String(row.rank),
            `${row.brand}${row.isOwnBrand ? " *" : ""}`,
            `${row.visibility.toFixed(1)}%`,
            String(row.mentions),
            row.position === null ? "-" : `#${row.position.toFixed(1)}`,
            row.sentiment === null ? "-" : row.sentiment.toFixed(1),
        ]),
    })
}
