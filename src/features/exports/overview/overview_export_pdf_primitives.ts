import type PDFKit from "pdfkit"
import { OVERVIEW_PDF as C } from "./overview_export_theme"

export function pdfText(value: unknown) {
    return String(value ?? "")
        .replace(/[\u2010-\u2015]/g, "-")
        .replace(/\u2026/g, "...")
        .replace(/[^\x20-\x7E]/g, "")
        .replace(/\s+/g, " ")
        .trim()
}

export function addPageHeader(doc: PDFKit.PDFDocument, brandName: string, title: string) {
    const width = doc.page.width
    doc.rect(0, 0, width, 70).fill(C.white)
    doc.moveTo(42, 69).lineTo(width - 42, 69).strokeColor(C.border).lineWidth(0.6).stroke()
    doc.fillColor(C.blue).font("Helvetica-Bold").fontSize(8)
        .text(pdfText(brandName).toUpperCase(), 42, 22, { characterSpacing: 1.2 })
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(18).text(pdfText(title), 42, 37)
}

export function addSectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
    doc.fillColor(C.blue).font("Helvetica-Bold").fontSize(8)
        .text(pdfText(title).toUpperCase(), 42, y, { characterSpacing: 1 })
    return y + 20
}

export function addFooter(
    doc: PDFKit.PDFDocument,
    brandName: string,
    page: number,
    total: number,
) {
    const width = doc.page.width
    const y = doc.page.height - 30
    doc.moveTo(42, y - 9).lineTo(width - 42, y - 9).strokeColor(C.border).lineWidth(0.5).stroke()
    doc.fillColor(C.muted).font("Helvetica").fontSize(7.5)
        .text(`Confidential - Prepared for ${pdfText(brandName)}`, 42, y, { width: 210, lineBreak: false })
    doc.fillColor(C.faint).text("Powered by PromptPulse", width / 2 - 75, y, {
        width: 150,
        align: "center",
        lineBreak: false,
    })
    doc.text(`Page ${page} of ${total}`, width - 130, y, {
        width: 88,
        align: "right",
        lineBreak: false,
    })
}

export function drawTable(input: {
    doc: PDFKit.PDFDocument
    y: number
    headers: string[]
    rows: string[][]
    widths: number[]
    linkColumn?: number
    links?: string[]
}) {
    const { doc, headers, rows, widths } = input
    const x0 = 42
    const headerHeight = 28
    const rowHeight = 25
    let y = input.y

    doc.roundedRect(x0, y, widths.reduce((sum, width) => sum + width, 0), headerHeight, 5).fill(C.navy)
    let x = x0
    headers.forEach((header, index) => {
        doc.fillColor("#BDD6EF").font("Helvetica-Bold").fontSize(7.5)
            .text(pdfText(header).toUpperCase(), x + 8, y + 8, {
                width: widths[index] - 16,
                height: headerHeight - 10,
                ellipsis: true,
            })
        x += widths[index]
    })
    y += headerHeight

    rows.forEach((row, rowIndex) => {
        if (rowIndex % 2 === 0) {
            doc.rect(x0, y, widths.reduce((sum, width) => sum + width, 0), rowHeight).fill(C.paper)
        }
        x = x0
        row.forEach((cell, columnIndex) => {
            const options: PDFKit.Mixins.TextOptions = {
                width: widths[columnIndex] - 16,
                height: rowHeight - 7,
                ellipsis: true,
            }
            if (input.linkColumn === columnIndex && input.links?.[rowIndex]) {
                options.link = input.links[rowIndex]
                options.underline = true
            }
            doc.fillColor(columnIndex === input.linkColumn ? C.blue : C.text)
                .font(columnIndex === 1 ? "Helvetica-Bold" : "Helvetica")
                .fontSize(8.5)
                .text(pdfText(cell), x + 8, y + 8, options)
            x += widths[columnIndex]
        })
        doc.moveTo(x0, y + rowHeight).lineTo(x0 + widths.reduce((sum, width) => sum + width, 0), y + rowHeight)
            .strokeColor(C.border).lineWidth(0.35).stroke()
        y += rowHeight
    })

    return y
}

export function drawMetricCard(input: {
    doc: PDFKit.PDFDocument
    x: number
    y: number
    width: number
    label: string
    value: string
    detail?: string
    accent?: string
}) {
    const { doc, x, y, width } = input
    doc.roundedRect(x, y, width, 78, 7).fillAndStroke(C.white, C.border)
    doc.rect(x, y, width, 3).fill(input.accent ?? C.sky)
    doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(7)
        .text(pdfText(input.label).toUpperCase(), x + 9, y + 13, { width: width - 18, ellipsis: true })
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(19)
        .text(pdfText(input.value), x + 9, y + 32, { width: width - 18, ellipsis: true })
    if (input.detail) {
        doc.fillColor(C.muted).font("Helvetica").fontSize(6.7)
            .text(pdfText(input.detail), x + 9, y + 57, { width: width - 18, height: 14, ellipsis: true })
    }
}

export function drawHorizontalBar(input: {
    doc: PDFKit.PDFDocument
    x: number
    y: number
    width: number
    label: string
    value: number
    max?: number
    color?: string
    suffix?: string
}) {
    const max = Math.max(input.max ?? 100, 1)
    const ratio = Math.min(1, Math.max(0, input.value / max))
    input.doc.fillColor(C.text).font("Helvetica-Bold").fontSize(8)
        .text(pdfText(input.label), input.x, input.y, { width: input.width - 52, ellipsis: true })
    input.doc.fillColor(C.muted).font("Helvetica").fontSize(8)
        .text(`${input.value.toFixed(1)}${input.suffix ?? ""}`, input.x + input.width - 50, input.y, { width: 50, align: "right" })
    input.doc.roundedRect(input.x, input.y + 14, input.width, 6, 3).fill(C.border)
    if (ratio > 0) input.doc.roundedRect(input.x, input.y + 14, Math.max(4, input.width * ratio), 6, 3).fill(input.color ?? C.blue)
}

export function drawTrendChart(input: {
    doc: PDFKit.PDFDocument
    x: number
    y: number
    width: number
    height: number
    points: Array<{ date: string; visibility: number }>
}) {
    const { doc, x, y, width, height, points } = input
    doc.roundedRect(x, y, width, height, 8).fillAndStroke(C.white, C.border)
    const left = x + 36
    const top = y + 20
    const plotWidth = width - 54
    const plotHeight = height - 52
    for (let step = 0; step <= 4; step += 1) {
        const value = 100 - step * 25
        const lineY = top + (step / 4) * plotHeight
        doc.moveTo(left, lineY).lineTo(left + plotWidth, lineY).strokeColor(C.border).lineWidth(0.35).stroke()
        doc.fillColor(C.faint).font("Helvetica").fontSize(6).text(String(value), x + 8, lineY - 3, { width: 22, align: "right" })
    }
    if (points.length > 1) {
        const px = (index: number) => left + (index / (points.length - 1)) * plotWidth
        const py = (value: number) => top + ((100 - Math.min(100, Math.max(0, value))) / 100) * plotHeight
        doc.moveTo(px(0), py(points[0].visibility))
        for (let index = 1; index < points.length; index += 1) doc.lineTo(px(index), py(points[index].visibility))
        doc.strokeColor(C.blue).lineWidth(2).stroke()
        points.forEach((point, index) => {
            if (index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0) {
                doc.circle(px(index), py(point.visibility), 2.4).fill(C.blue)
            }
        })
        doc.fillColor(C.muted).font("Helvetica").fontSize(6.5)
            .text(points[0].date.slice(5), left, y + height - 20, { width: 50 })
            .text(points.at(-1)!.date.slice(5), left + plotWidth - 50, y + height - 20, { width: 50, align: "right" })
    } else {
        doc.fillColor(C.muted).font("Helvetica").fontSize(9)
            .text("More than one response date is required to draw a trend.", x + 30, y + height / 2 - 5, { width: width - 60, align: "center" })
    }
}
