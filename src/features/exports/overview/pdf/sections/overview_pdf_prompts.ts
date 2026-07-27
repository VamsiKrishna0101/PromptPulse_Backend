import type { OverviewExportModel } from "../../overview_export_types"
import { OVERVIEW_PDF as C } from "../../overview_export_theme"
import { addPageHeader, addSectionTitle, drawMetricCard, drawTable } from "../../overview_export_pdf_primitives"
import { overviewShorten } from "../overview_pdf_format"

export function renderOverviewPrompts(doc: PDFKit.PDFDocument, model: OverviewExportModel) {
    addPageHeader(doc, model.brandName, "Buyer prompt and topic intelligence")
    let y = 92
    const gaps = model.prompts.filter(prompt => prompt.status === "GAP")
    const opportunities = model.prompts.filter(prompt => prompt.status === "OPPORTUNITY")
    const leaders = [...model.prompts].filter(prompt => prompt.status === "LEADER").sort((a, b) => b.visibility - a.visibility)
    const summary = [
        ["Prompts represented", model.coverage.representedPrompts, C.sky],
        ["Visibility gaps", gaps.length, "#F59E0B"],
        ["Leading prompts", leaders.length, C.mint],
    ] as const
    summary.forEach((item, index) => drawMetricCard({
        doc,
        x: 42 + index * 174,
        y,
        width: 164,
        label: item[0],
        value: String(item[1]),
        detail: "Measured in this report",
        accent: item[2],
    }))
    y += 106
    y = addSectionTitle(doc, "Priority buyer prompts", y)
    y = drawTable({
        doc,
        y,
        headers: ["Prompt", "Topic", "Checks", "Visibility", "Position", "Status"],
        widths: [218, 86, 58, 64, 52, 63],
        rows: [...gaps, ...opportunities, ...leaders].slice(0, 8).map(row => [
            overviewShorten(row.prompt, 55),
            overviewShorten(row.topic, 18),
            String(row.responses),
            `${row.visibility.toFixed(1)}%`,
            row.position === null ? "-" : `#${row.position.toFixed(1)}`,
            row.status === "OPPORTUNITY" ? "IMPROVE" : row.status,
        ]),
    })
    y += 28
    y = addSectionTitle(doc, "Topic coverage", y)
    drawTable({
        doc,
        y,
        headers: ["Topic", "Prompts", "Responses", "Visibility", "Avg. position"],
        widths: [210, 70, 80, 76, 75],
        rows: model.topics.slice(0, 7).map(row => [
            overviewShorten(row.topic, 38),
            String(row.prompts),
            String(row.responses),
            `${row.visibility.toFixed(1)}%`,
            row.position === null ? "-" : `#${row.position.toFixed(1)}`,
        ]),
    })
}
