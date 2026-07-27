import ExcelJS from "exceljs"
import type { OverviewExportModel } from "./overview_export_types"
import { fetchBrandLogo } from "./overview_export_assets"
import { OVERVIEW_XL as C } from "./overview_export_theme"

function header(cell: ExcelJS.Cell) {
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: C.white } }
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } }
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true }
}

function titleBand(sheet: ExcelJS.Worksheet, title: string, subtitle: string, columns: number) {
    const last = sheet.getColumn(columns).letter
    sheet.mergeCells(`A1:${last}1`)
    sheet.getCell("A1").value = title
    sheet.getCell("A1").font = { name: "Aptos Display", size: 20, bold: true, color: { argb: C.white } }
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } }
    sheet.getCell("A1").alignment = { vertical: "middle", indent: 1 }
    sheet.getRow(1).height = 38
    sheet.mergeCells(`A2:${last}2`)
    sheet.getCell("A2").value = subtitle
    sheet.getCell("A2").font = { name: "Aptos", size: 10, color: { argb: C.muted } }
    sheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.paper } }
    sheet.getCell("A2").alignment = { vertical: "middle", indent: 1 }
    sheet.getRow(2).height = 25
    sheet.views = [{ state: "frozen", ySplit: 4, topLeftCell: "A5", activeCell: "A5", showGridLines: false }]
}

function addHeaders(sheet: ExcelJS.Worksheet, labels: string[]) {
    labels.forEach((label, index) => {
        const cell = sheet.getCell(4, index + 1)
        cell.value = label
        header(cell)
    })
    sheet.getRow(4).height = 28
}

function styleRows(sheet: ExcelJS.Worksheet, start: number, end: number, columns: number) {
    for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
        const row = sheet.getRow(rowIndex)
        row.height = 23
        for (let columnIndex = 1; columnIndex <= columns; columnIndex += 1) {
            const cell = row.getCell(columnIndex)
            cell.font = { name: "Aptos", size: 10, color: { argb: C.text } }
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowIndex % 2 === 0 ? C.paper : C.white } }
            cell.border = { bottom: { style: "hair", color: { argb: C.border } } }
            cell.alignment = { vertical: "middle", wrapText: false }
        }
    }
}

function addDataSheet(
    workbook: ExcelJS.Workbook,
    input: {
        name: string
        title: string
        subtitle: string
        tabColor: string
        widths: number[]
        headers: string[]
        rows: Array<Array<ExcelJS.CellValue>>
    },
) {
    const sheet = workbook.addWorksheet(input.name, { properties: { tabColor: { argb: input.tabColor } } })
    sheet.columns = input.widths.map(width => ({ width }))
    titleBand(sheet, input.title, input.subtitle, input.headers.length)
    addHeaders(sheet, input.headers)
    input.rows.forEach((values, index) => { sheet.getRow(index + 5).values = values })
    styleRows(sheet, 5, input.rows.length + 4, input.headers.length)
    sheet.autoFilter = { from: "A4", to: `${sheet.getColumn(input.headers.length).letter}${Math.max(5, input.rows.length + 4)}` }
    return sheet
}

export async function buildOverviewExcel(model: OverviewExportModel): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = model.brandName
    workbook.created = model.generatedAt
    workbook.modified = model.generatedAt

    const summary = workbook.addWorksheet("Executive Summary", { properties: { tabColor: { argb: C.blue } } })
    summary.views = [{ state: "normal", showGridLines: false }]
    summary.columns = [{ width: 24 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }]
    summary.mergeCells("A1:F2")
    summary.getCell("A1").value = `${model.brandName}\nAI Visibility Intelligence Report`
    summary.getCell("A1").font = { name: "Aptos Display", size: 20, bold: true, color: { argb: C.white } }
    summary.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } }
    summary.getCell("A1").alignment = { vertical: "middle", indent: 1, wrapText: true }
    summary.getRow(1).height = 34
    summary.getRow(2).height = 34
    const logo = await fetchBrandLogo(model.brandUrl)
    if (logo) {
        try {
            const imageId = workbook.addImage({ base64: `data:image/png;base64,${logo.toString("base64")}`, extension: "png" })
            summary.addImage(imageId, { tl: { col: 5.1, row: 0.2 }, ext: { width: 56, height: 56 } })
        } catch {
            // The customer brand name remains the resilient fallback.
        }
    }
    summary.mergeCells("A4:F4")
    summary.getCell("A4").value = model.executiveHeadline
    summary.getCell("A4").font = { name: "Aptos", size: 12, bold: true, color: { argb: C.ink } }
    summary.getCell("A4").fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.softBlue } }
    summary.getCell("A4").alignment = { vertical: "middle", wrapText: true, indent: 1 }
    summary.getRow(4).height = 48
    model.metrics.forEach((item, index) => {
        const column = index + 1
        summary.getCell(6, column).value = item.label.toUpperCase()
        summary.getCell(6, column).font = { name: "Aptos", size: 8, bold: true, color: { argb: C.muted } }
        summary.getCell(7, column).value = item.value
        summary.getCell(7, column).font = { name: "Aptos Display", size: 18, bold: true, color: { argb: C.ink } }
        summary.getCell(7, column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.paper } }
        summary.getCell(8, column).value = item.delta === null ? "No comparison" : `${item.delta > 0 ? "+" : ""}${item.delta.toFixed(1)} vs previous`
        summary.getCell(8, column).font = { name: "Aptos", size: 8, color: { argb: C.muted } }
        if (item.format === "percent") summary.getCell(7, column).numFmt = '0.0"%"'
        if (item.format === "position") summary.getCell(7, column).numFmt = '"#"0.0'
    })
    summary.getCell("A10").value = "Reporting period"
    summary.getCell("B10").value = model.periodLabel
    summary.getCell("A11").value = "Generated"
    summary.getCell("B11").value = model.generatedAt
    summary.getCell("B11").numFmt = "dd mmm yyyy"
    summary.getCell("A13").value = "LEADERSHIP READOUT"
    summary.getCell("A13").font = { name: "Aptos", size: 9, bold: true, color: { argb: C.blue } }
    model.executivePoints.forEach((point, index) => {
        summary.mergeCells(`A${14 + index}:F${14 + index}`)
        summary.getCell(14 + index, 1).value = `${index + 1}. ${point}`
        summary.getCell(14 + index, 1).alignment = { wrapText: true, vertical: "middle", indent: 1 }
        summary.getRow(14 + index).height = 28
    })

    const trend = addDataSheet(workbook, {
        name: "Visibility Trend",
        title: "Visibility trend",
        subtitle: `${model.periodLabel} - daily measured visibility`,
        tabColor: C.sky,
        widths: [18, 20, 20],
        headers: ["Date", "Visibility %", "Responses"],
        rows: model.trend.map(item => [item.date, item.visibility / 100, item.responses]),
    })
    trend.getColumn(2).numFmt = "0.0%"

    const engines = addDataSheet(workbook, {
        name: "AI Engines",
        title: "AI engine performance",
        subtitle: "Response coverage, visibility, rank, sentiment, and source diversity",
        tabColor: C.blue,
        widths: [22, 16, 18, 18, 18, 18],
        headers: ["AI Engine", "Responses", "Visibility %", "Avg. Position", "Sentiment", "Source Domains"],
        rows: model.engines.map(item => [item.engine, item.responses, item.visibility / 100, item.position, item.sentiment, item.sourceDomains]),
    })
    engines.getColumn(3).numFmt = "0.0%"

    const prompts = addDataSheet(workbook, {
        name: "Prompt Intelligence",
        title: "Prompt intelligence",
        subtitle: "Prompt-level performance ranked by the clearest visibility gaps first",
        tabColor: C.sky,
        widths: [52, 22, 14, 18, 16, 16, 18],
        headers: ["Prompt", "Topic", "Responses", "Visibility %", "Avg. Position", "Sentiment", "Status"],
        rows: model.prompts.map(item => [item.prompt, item.topic, item.responses, item.visibility / 100, item.position, item.sentiment, item.status]),
    })
    prompts.getColumn(4).numFmt = "0.0%"

    const brands = addDataSheet(workbook, {
        name: "Competitive Landscape",
        title: "Competitive landscape",
        subtitle: "Case-insensitive normalized brand visibility, mentions, position, and sentiment",
        tabColor: C.navySoft,
        widths: [9, 34, 18, 15, 18, 18, 16],
        headers: ["Rank", "Brand", "Visibility %", "Mentions", "Avg. Position", "Sentiment", "Status"],
        rows: model.brands.map(item => [item.rank, item.brand, item.visibility / 100, item.mentions, item.position, item.sentiment, item.isOwnBrand ? "Tracked brand" : "Competitor"]),
    })
    brands.getColumn(3).numFmt = "0.0%"

    const sources = addDataSheet(workbook, {
        name: "Source Influence",
        title: "Source influence",
        subtitle: "Exact source links, usage, citation counts, and confirmed brand presence",
        tabColor: C.mint,
        widths: [9, 30, 44, 18, 18, 16, 20, 58],
        headers: ["Rank", "Domain", "Title", "Used %", "Source Type", "Citations", "Brand Presence", "URL"],
        rows: model.sources.map(item => [
            item.rank,
            item.domain,
            item.title,
            item.usedPct / 100,
            item.sourceType,
            item.citations,
            item.brandPresence === "CONFIRMED" ? "Confirmed" : "Not confirmed",
            { text: item.url, hyperlink: item.url },
        ]),
    })
    sources.getColumn(4).numFmt = "0.0%"
    for (let row = 5; row < model.sources.length + 5; row += 1) {
        sources.getCell(row, 8).font = { name: "Aptos", size: 10, color: { argb: C.blue }, underline: true }
    }

    addDataSheet(workbook, {
        name: "Opportunities",
        title: "Evidence-backed opportunities",
        subtitle: "Prioritized actions derived from stored response evidence",
        tabColor: C.blue,
        widths: [38, 52, 26, 14, 14, 12, 70],
        headers: ["Opportunity", "Prompt", "Competitor", "Impact", "Effort", "Score", "Next Step"],
        rows: model.opportunities.map(item => [item.title, item.prompt, item.competitor, item.impact, item.effort, item.score, item.nextStep]),
    })

    const evidence = addDataSheet(workbook, {
        name: "Response Evidence",
        title: "Response evidence appendix",
        subtitle: "Recent stored responses included in this report",
        tabColor: C.navySoft,
        widths: [20, 18, 58, 14, 12, 14, 30],
        headers: ["Date", "AI Engine", "Prompt", "Mentioned", "Position", "Sentiment", "Top Source"],
        rows: model.evidence.map(item => [item.date, item.engine, item.prompt, item.mentioned ? "Yes" : "No", item.position, item.sentiment, item.source]),
    })
    evidence.getColumn(1).numFmt = "dd mmm yyyy"

    const methodology = workbook.addWorksheet("Methodology", { properties: { tabColor: { argb: C.navySoft } } })
    methodology.columns = [{ width: 8 }, { width: 100 }]
    titleBand(methodology, "Methodology and coverage", "Definitions, limits, and data coverage", 2)
    const coverageRows = [
        ["Reporting period", model.periodLabel],
        ["Active prompts", model.coverage.activePrompts],
        ["Responses", model.coverage.responses],
        ["Successful runs", model.coverage.successfulRuns],
        ["Failed runs", model.coverage.failedRuns],
        ["Completed jobs", model.coverage.completedJobs],
        ["Failed jobs", model.coverage.failedJobs],
    ]
    coverageRows.forEach((item, index) => {
        methodology.getCell(index + 4, 1).value = item[0]
        methodology.getCell(index + 4, 1).font = { name: "Aptos", size: 9, bold: true, color: { argb: C.blue } }
        methodology.getCell(index + 4, 2).value = item[1]
    })
    model.methodology.forEach((item, index) => {
        const row = methodology.getRow(index + 13)
        row.getCell(1).value = index + 1
        row.getCell(2).value = item
        row.getCell(2).alignment = { wrapText: true, vertical: "top" }
        row.height = 34
    })
    methodology.views = [{ state: "normal", showGridLines: false }]

    return Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer)
}
