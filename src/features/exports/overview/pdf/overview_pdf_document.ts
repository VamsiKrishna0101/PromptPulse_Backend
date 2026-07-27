import PDFDocument from "pdfkit"
import type { OverviewExportModel } from "../overview_export_types"
import { fetchBrandLogo } from "../overview_export_assets"
import { addFooter } from "../overview_export_pdf_primitives"
import { renderOverviewActions } from "./sections/overview_pdf_actions"
import { renderOverviewCompetition } from "./sections/overview_pdf_competition"
import { renderOverviewCover } from "./sections/overview_pdf_cover"
import { renderOverviewCoverage } from "./sections/overview_pdf_coverage"
import { renderOverviewEvidence } from "./sections/overview_pdf_evidence"
import { renderOverviewExecutive } from "./sections/overview_pdf_executive"
import { renderOverviewPerformance } from "./sections/overview_pdf_performance"
import { renderOverviewPrompts } from "./sections/overview_pdf_prompts"
import { renderOverviewSources } from "./sections/overview_pdf_sources"

export async function buildOverviewPdfDocument(model: OverviewExportModel): Promise<Buffer> {
    const logo = await fetchBrandLogo(model.brandUrl)
    return await new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            margin: 0,
            size: "A4",
            bufferPages: true,
            info: {
                Title: `${model.brandName} AI Visibility Intelligence Report`,
                Author: model.brandName,
                Subject: "AI visibility, buyer prompt, competitor, source, and action intelligence",
            },
        })
        const chunks: Buffer[] = []
        doc.on("data", chunk => chunks.push(chunk))
        doc.on("end", () => resolve(Buffer.concat(chunks)))
        doc.on("error", reject)

        renderOverviewCover(doc, model, logo)
        doc.addPage(); renderOverviewExecutive(doc, model)
        doc.addPage(); renderOverviewPerformance(doc, model)
        doc.addPage(); renderOverviewPrompts(doc, model)
        doc.addPage(); renderOverviewCompetition(doc, model)
        doc.addPage(); renderOverviewSources(doc, model)
        doc.addPage(); renderOverviewActions(doc, model)
        doc.addPage(); renderOverviewCoverage(doc, model)
        if (model.evidence.length) {
            doc.addPage()
            renderOverviewEvidence(doc, model)
        }

        const range = doc.bufferedPageRange()
        for (let index = 1; index < range.count; index += 1) {
            doc.switchToPage(index)
            addFooter(doc, model.brandName, index + 1, range.count)
        }
        doc.end()
    })
}
