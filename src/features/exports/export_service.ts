import { Prisma } from "@prisma/client"
import ExcelJS from "exceljs"
import PDFDocument from "pdfkit"
import prisma from "../../lib/prisma"
import type { CsvExport, ExcelExport, ExportFilters, ExportResource, PdfExport } from "./export_types"
import { buildOverviewPdf } from "./overview/overview_export_pdf"
import { buildOverviewExcel } from "./overview/overview_export_excel"
import { getOverviewExportModel } from "./overview/overview_export_data"

// ─── Types ────────────────────────────────────────────────────────────────────

type CsvValue = string | number | boolean | Date | null | undefined
type CsvRow = Record<string, CsvValue | CsvValue[]>

// ─── Design system ────────────────────────────────────────────────────────────

/** Excel ARGB hex — full opacity prefix "FF" + 6-digit hex */
const XL = {
    navy: "FF0F172A",
    navyMid: "FF1E293B",
    blue: "FF3B82F6",
    blueLight: "FFdbeafe",
    muted: "FF94A3B8",
    border: "FFE2E8F0",
    stripe: "FFF8FAFC",
    white: "FFFFFFFF",
    text: "FF1E293B",
    green: "FF10B981",
    amber: "FFF59E0B",
    rose: "FFEF4444",
    sectionBg: "FFEFF6FF",
}

/** PDF palette (hex strings) */
const PDF = {
    navy: "#0F172A",
    blue: "#3B82F6",
    blueLight: "#EFF6FF",
    text: "#1E293B",
    muted: "#64748B",
    border: "#E2E8F0",
    stripe: "#F8FAFC",
    white: "#FFFFFF",
}

// ─── Column metadata ──────────────────────────────────────────────────────────

type ColMeta = {
    label: string
    width: number
    numFmt?: string
    align?: "left" | "center" | "right"
    bold?: boolean
}

const COL: Record<string, ColMeta> = {
    // overview
    section: { label: "Section", width: 16, align: "left" },
    item: { label: "Item", width: 30, align: "left" },
    value: { label: "Value", width: 18, align: "right" },
    detail: { label: "Detail", width: 48, align: "left" },
    rank: { label: "#", width: 6, align: "center" },
    // prompts
    prompt_id: { label: "Prompt ID", width: 12, align: "left" },
    prompt: { label: "Prompt", width: 52, align: "left" },
    topic: { label: "Topic", width: 20, align: "left" },
    status: { label: "Status", width: 14, align: "center" },
    source: { label: "Source", width: 14, align: "left" },
    total_chats: { label: "Chats", width: 10, align: "right" },
    visibility_pct: { label: "Visibility %", width: 14, align: "right", numFmt: "0.00\"%\"" },
    avg_position: { label: "Avg. Position", width: 14, align: "right", numFmt: "0.00" },
    avg_sentiment: { label: "Avg. Sentiment", width: 14, align: "right", numFmt: "0.00" },
    models: { label: "AI Models", width: 24, align: "left" },
    mentioned_brands: { label: "Mentioned Brands", width: 30, align: "left" },
    last_run_at: { label: "Last Run", width: 20, align: "left" },
    created_at: { label: "Created", width: 20, align: "left" },
    // chats
    chat_id: { label: "Chat ID", width: 12, align: "left" },
    model: { label: "AI Model", width: 18, align: "left" },
    brand_mentioned: { label: "Mentioned", width: 12, align: "center" },
    brand_position: { label: "Position", width: 12, align: "right", numFmt: "0" },
    sentiment_score: { label: "Sentiment", width: 12, align: "right", numFmt: "0.00" },
    sources: { label: "Source Domains", width: 32, align: "left" },
    raw_response: { label: "AI Response", width: 60, align: "left" },
    // sources
    source_id: { label: "Source ID", width: 12, align: "left" },
    url: { label: "URL", width: 50, align: "left" },
    domain: { label: "Domain", width: 28, align: "left" },
    title: { label: "Title", width: 40, align: "left" },
    source_type: { label: "Source Type", width: 16, align: "center" },
    url_type: { label: "URL Type", width: 16, align: "center" },
    cited: { label: "Cited", width: 10, align: "center" },
    used_by_ai: { label: "Used by AI", width: 12, align: "center" },
    platform: { label: "Platform", width: 16, align: "left" },
    subreddit: { label: "Subreddit", width: 18, align: "left" },
    chat_created_at: { label: "Chat Date", width: 20, align: "left" },
    snippet: { label: "Snippet", width: 50, align: "left" },
    // competitors
    competitor_id: { label: "Competitor ID", width: 12, align: "left" },
    competitor: { label: "Competitor", width: 26, align: "left" },
    mentions: { label: "Mentions", width: 12, align: "right" },
    // web analytics
    event_id: { label: "Event ID", width: 12, align: "left" },
    site: { label: "Site", width: 20, align: "left" },
    type: { label: "Event Type", width: 16, align: "left" },
    path: { label: "Path", width: 36, align: "left" },
    referrer: { label: "Referrer", width: 36, align: "left" },
    event_name: { label: "Event Name", width: 24, align: "left" },
    duration_ms: { label: "Duration (ms)", width: 14, align: "right", numFmt: "#,##0" },
    visitor_id: { label: "Visitor ID", width: 20, align: "left" },
    browser: { label: "Browser", width: 16, align: "left" },
    device: { label: "Device", width: 14, align: "left" },
    country: { label: "Country", width: 14, align: "left" },
    medium: { label: "Medium", width: 14, align: "left" },
}

const RESOURCE_LABEL: Record<ExportResource, string> = {
    overview: "AI Visibility Overview",
    prompts: "Prompt Analysis",
    chats: "Chat Responses",
    sources: "Source Intelligence",
    competitors: "Competitor Benchmarking",
    "web-analytics": "Web Analytics",
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createCsvExport(input: {
    project_id: string
    resource: ExportResource
    filters: ExportFilters
}): Promise<CsvExport> {
    // kept for backwards compat — just wraps the Excel export as CSV text
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: input.project_id }, select: { brand_name: true },
    })
    const rows = await getRows(input.project_id, input.resource, input.filters)
    const csv = rowsToCsv(rows)
    const filename = buildFilename(project.brand_name, input.resource, "csv")
    return { filename, content: csv }
}

export async function createExcelExport(input: {
    project_id: string
    resource: ExportResource
    filters: ExportFilters
}): Promise<ExcelExport> {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: input.project_id }, select: { brand_name: true, brand_url: true },
    })
    const rows = input.resource === "overview" ? [] : await getRows(input.project_id, input.resource, input.filters)
    const content = input.resource === "overview"
        ? await buildOverviewExcel(await getOverviewExportModel(input.project_id, input.filters))
        : await buildExcel(project.brand_name, input.resource, input.filters, rows)
    const filename = buildFilename(project.brand_name, input.resource, "xlsx")
    return { filename, content }
}

export async function createPdfExport(input: {
    project_id: string
    resource: ExportResource
    filters: ExportFilters
}): Promise<PdfExport> {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: input.project_id }, select: { brand_name: true, brand_url: true },
    })
    const rows = input.resource === "overview" ? [] : await getRows(input.project_id, input.resource, input.filters)
    const content = input.resource === "overview"
        ? await buildOverviewPdf(await getOverviewExportModel(input.project_id, input.filters))
        : await buildPdf(project.brand_name, input.resource, input.filters, rows)
    const filename = buildFilename(project.brand_name, input.resource, "pdf")
    return { filename, content }
}

export async function createGeoArticlePdf(input: {
    project_id: string
    brief:      any
    article:    any
}): Promise<PdfExport> {
    const project = await prisma.project.findUniqueOrThrow({
        where: { id: input.project_id }, select: { brand_name: true },
    })
    const content  = await buildGeoArticlePdfKit(project.brand_name, input.brief, input.article)
    const filename = buildFilename(project.brand_name, "geo-article" as ExportResource, "pdf")
    return { filename, content }
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getRows(project_id: string, resource: ExportResource, filters: ExportFilters): Promise<CsvRow[]> {
    if (resource === "overview") return getOverviewRows(project_id, filters)
    if (resource === "prompts") return getPromptRows(project_id, filters)
    if (resource === "chats") return getChatRows(project_id, filters)
    if (resource === "sources") return getSourceRows(project_id, filters)
    if (resource === "competitors") return getCompetitorRows(project_id, filters)
    if (resource === "web-analytics") return getWebAnalyticsRows(project_id, filters)
    return []
}

async function getOverviewRows(project_id: string, filters: ExportFilters): Promise<CsvRow[]> {
    const report = await getOverviewReport(project_id, filters)
    return [
        ...report.summary.map(r => ({ section: "Summary", item: r.metric, value: r.value, detail: r.description, rank: "" })),
        ...report.brands.map(r => ({ section: "Brands", item: r.brand, value: r.visibility_pct, detail: `Pos: ${r.avg_position || "–"} | Sent: ${r.avg_sentiment || "–"}`, rank: r.rank })),
        ...report.sources.map(r => ({ section: "Sources", item: r.domain, value: r.used_pct, detail: `${r.source_type} | Avg citations: ${r.avg_citations}`, rank: r.rank })),
    ]
}

async function getOverviewReport(project_id: string, filters: ExportFilters) {
    const [project, chats] = await Promise.all([
        prisma.project.findUniqueOrThrow({ where: { id: project_id }, include: { competitors: true } }),
        getFilteredChats(project_id, filters),
    ])

    const totalChats = chats.length
    const mentionedChats = chats.filter(c => c.brand_mentioned)
    const sourceDomains = new Set(chats.flatMap(c => c.sources.map(s => s.domain)))

    const brandMap = new Map<string, { mentions: number; totalPos: number; totalSent: number; posCount: number; sentCount: number }>()
    for (const chat of chats) {
        for (const m of chat.brand_mentions) {
            const e = brandMap.get(m.brand_name) ?? { mentions: 0, totalPos: 0, totalSent: 0, posCount: 0, sentCount: 0 }
            e.mentions += 1
            if (typeof m.position === "number") { e.totalPos += m.position; e.posCount += 1 }
            if (typeof m.sentiment_score === "number") { e.totalSent += m.sentiment_score; e.sentCount += 1 }
            brandMap.set(m.brand_name, e)
        }
    }
    if (!brandMap.has(project.brand_name)) {
        brandMap.set(project.brand_name, {
            mentions: mentionedChats.length,
            totalPos: mentionedChats.reduce((s, c) => s + (c.brand_position ?? 0), 0),
            totalSent: mentionedChats.reduce((s, c) => s + (c.sentiment_score ?? 0), 0),
            posCount: mentionedChats.filter(c => typeof c.brand_position === "number").length,
            sentCount: mentionedChats.filter(c => typeof c.sentiment_score === "number").length,
        })
    }

    const sourceMap = new Map<string, { count: number; citations: number; type: string }>()
    for (const chat of chats) {
        for (const domain of new Set(chat.sources.map(s => s.domain))) {
            const srcs = chat.sources.filter(s => s.domain === domain)
            const e = sourceMap.get(domain) ?? { count: 0, citations: 0, type: srcs[0]?.source_type ?? "OTHER" }
            e.count += 1
            e.citations += srcs.filter(s => s.is_cited).length
            sourceMap.set(domain, e)
        }
    }

    return {
        summary: [
            { metric: "Total Chats", value: totalChats, description: "AI responses included in this export" },
            { metric: "Brand Visibility", value: totalChats ? pct(mentionedChats.length, totalChats) : 0, description: "% of chats where brand was mentioned" },
            { metric: "Avg. Position", value: average(mentionedChats.map(c => c.brand_position)), description: "Average rank when mentioned" },
            { metric: "Avg. Sentiment", value: average(mentionedChats.map(c => c.sentiment_score)), description: "Avg sentiment score for brand mentions" },
            { metric: "Unique Source Domains", value: sourceDomains.size, description: "Distinct domains influencing AI answers" },
        ],
        brands: Array.from(brandMap.entries())
            .map(([brand, d]) => ({
                brand,
                visibility_pct: totalChats ? pct(d.mentions, totalChats) : 0,
                mentions: d.mentions,
                avg_position: d.posCount ? round2(d.totalPos / d.posCount) : "",
                avg_sentiment: d.sentCount ? round2(d.totalSent / d.sentCount) : "",
            }))
            .sort((a, b) => b.visibility_pct - a.visibility_pct)
            .slice(0, 8)
            .map((r, i) => ({ rank: i + 1, ...r })),
        sources: Array.from(sourceMap.entries())
            .map(([domain, d]) => ({
                domain,
                source_type: d.type,
                used_pct: totalChats ? pct(d.count, totalChats) : 0,
                avg_citations: d.count ? round2(d.citations / d.count) : 0,
            }))
            .sort((a, b) => b.used_pct - a.used_pct)
            .slice(0, 10)
            .map((r, i) => ({ rank: i + 1, ...r })),
    }
}

async function getPromptRows(project_id: string, filters: ExportFilters): Promise<CsvRow[]> {
    const prompts = await prisma.prompt.findMany({
        where: {
            project_id,
            ...(filters.topic ? { topic: filters.topic } : {}),
            ...(filters.status ? { status: filters.status as Prisma.PromptWhereInput["status"] } : {}),
        },
        include: { chats: { where: buildChatOnlyWhere(filters), include: { brand_mentions: true } } },
        orderBy: { created_at: "desc" },
    })
    return prompts.map(p => {
        const chats = p.chats
        const mentioned = chats.filter(c => c.brand_mentioned)
        const brands = new Set(chats.flatMap(c => c.brand_mentions.map(m => m.brand_name)))
        return {
            prompt_id: p.id,
            prompt: p.text,
            topic: p.topic,
            status: p.status,
            source: p.source,
            total_chats: chats.length,
            visibility_pct: chats.length ? pct(mentioned.length, chats.length) : 0,
            avg_position: average(mentioned.map(c => c.brand_position)),
            avg_sentiment: average(chats.map(c => c.sentiment_score)),
            models: [...new Set(chats.map(c => c.ai_model))],
            mentioned_brands: [...brands],
            last_run_at: p.last_run_at,
            created_at: p.created_at,
        }
    })
}

async function getChatRows(project_id: string, filters: ExportFilters): Promise<CsvRow[]> {
    const chats = await getFilteredChats(project_id, filters)
    return chats.map(c => ({
        chat_id: c.id,
        created_at: c.created_at,
        model: c.ai_model,
        prompt: c.prompt.text,
        topic: c.prompt.topic,
        brand_mentioned: c.brand_mentioned,
        brand_position: c.brand_position,
        sentiment_score: c.sentiment_score,
        mentioned_brands: c.brand_mentions.map(m => m.brand_name),
        sources: [...new Set(c.sources.map(s => s.domain))],
        raw_response: c.raw_response,
    }))
}

async function getSourceRows(project_id: string, filters: ExportFilters): Promise<CsvRow[]> {
    const sources = await prisma.source.findMany({
        where: { chat: buildChatWhere(project_id, filters) },
        include: { chat: { include: { prompt: true, brand_mentions: true } }, source_url_content: true },
        orderBy: { created_at: "desc" },
    })
    return sources.map(s => ({
        source_id: s.id,
        url: s.url,
        domain: s.domain,
        title: s.title ?? s.source_url_content?.title,
        source_type: s.source_type,
        url_type: s.url_type,
        cited: s.is_cited,
        used_by_ai: s.used_by_ai,
        platform: s.platform,
        subreddit: s.subreddit,
        prompt: s.chat.prompt.text,
        topic: s.chat.prompt.topic,
        model: s.chat.ai_model,
        chat_created_at: s.chat.created_at,
        mentioned_brands: s.chat.brand_mentions.map(m => m.brand_name),
        snippet: s.snippet ?? s.source_url_content?.snippet,
    }))
}

async function getCompetitorRows(project_id: string, filters: ExportFilters): Promise<CsvRow[]> {
    const chats = await getFilteredChats(project_id, filters)
    const totalChats = chats.length
    const competitors = await prisma.competitor.findMany({ where: { project_id }, orderBy: { name: "asc" } })
    return competitors.map(comp => {
        const mentions = chats.flatMap(c => c.brand_mentions)
            .filter(m => m.brand_name.toLowerCase() === comp.name.toLowerCase())
        return {
            competitor_id: comp.id,
            competitor: comp.name,
            url: comp.url,
            visibility_pct: totalChats ? pct(mentions.length, totalChats) : 0,
            mentions: mentions.length,
            avg_position: average(mentions.map(m => m.position)),
            avg_sentiment: average(mentions.map(m => m.sentiment_score)),
            created_at: comp.created_at,
        }
    })
}

async function getWebAnalyticsRows(project_id: string, filters: ExportFilters): Promise<CsvRow[]> {
    const siteIds = await prisma.webAnalyticsSite.findMany({ where: { project_id }, select: { id: true } })
    const ids = siteIds.map(s => s.id)
    if (ids.length === 0) return []
    const events = await prisma.webAnalyticsEvent.findMany({
        where: {
            site_id: { in: ids },
            ...(filters.days ? { created_at: { gte: daysAgo(filters.days) } } : {}),
            ...(filters.q ? {
                OR: [
                    { path: { contains: filters.q, mode: "insensitive" } },
                    { title: { contains: filters.q, mode: "insensitive" } },
                    { url: { contains: filters.q, mode: "insensitive" } },
                ]
            } : {}),
        },
        include: { site: true, session: true },
        orderBy: { created_at: "desc" },
        take: 5000,
    })
    return events.map(e => ({
        event_id: e.id,
        created_at: e.created_at,
        site: e.site.name,
        domain: e.site.domain,
        type: e.type,
        path: e.path,
        url: e.url,
        title: e.title,
        referrer: e.referrer,
        event_name: e.event_name,
        duration_ms: e.duration_ms,
        visitor_id: e.session?.visitor_id,
        browser: e.session?.browser,
        device: e.session?.device,
        country: e.session?.country,
        source: e.session?.source,
        medium: e.session?.medium,
    }))
}

async function getFilteredChats(project_id: string, filters: ExportFilters) {
    return prisma.chat.findMany({
        where: buildChatWhere(project_id, filters),
        include: { prompt: true, brand_mentions: true, sources: true },
        orderBy: { created_at: "desc" },
        take: 5000,
    })
}

function buildChatWhere(project_id: string, filters: ExportFilters): Prisma.ChatWhereInput {
    const promptWhere: Prisma.PromptWhereInput = { project_id }
    if (filters.topic) promptWhere.topic = filters.topic
    const where: Prisma.ChatWhereInput = { prompt: promptWhere, ...buildChatOnlyWhere(filters) }
    const q = filters.q?.trim()
    if (q) {
        where.OR = [
            { raw_response: { contains: q, mode: "insensitive" } },
            { prompt: { text: { contains: q, mode: "insensitive" } } },
            { brand_mentions: { some: { brand_name: { contains: q, mode: "insensitive" } } } },
            { sources: { some: { domain: { contains: q, mode: "insensitive" } } } },
            { sources: { some: { title: { contains: q, mode: "insensitive" } } } },
        ]
    }
    return where
}

function buildChatOnlyWhere(filters: ExportFilters): Prisma.ChatWhereInput {
    return {
        ...(filters.days ? { created_at: { gte: daysAgo(filters.days) } } : {}),
        ...(filters.model ? { ai_model: { contains: filters.model, mode: "insensitive" } } : {}),
    }
}

// ─── Excel (.xlsx) builder ────────────────────────────────────────────────────

async function buildExcel(
    brandName: string,
    resource: ExportResource,
    filters: ExportFilters,
    rows: CsvRow[],
): Promise<Buffer> {
    const wb = new ExcelJS.Workbook()
    wb.creator = "PromptPulse"
    wb.created = new Date()
    wb.modified = new Date()

    // ── Cover / Meta sheet ────────────────────────────────────────────────────
    const meta = wb.addWorksheet("Report Info", { tabColor: { argb: XL.blue } })
    meta.getColumn(1).width = 28
    meta.getColumn(2).width = 44

    // Big navy header spanning A1:B1
    meta.mergeCells("A1:B1")
    const titleCell = meta.getCell("A1")
    titleCell.value = `${brandName}  ·  ${RESOURCE_LABEL[resource]}`
    titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: XL.white } }
    titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL.navy } }
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 }
    meta.getRow(1).height = 36

    // Metadata rows
    const metaRows = [
        ["Generated", fmtDate(new Date())],
        ["Brand", brandName],
        ["Report Type", RESOURCE_LABEL[resource]],
        ["Filter: Days", filters.days ? `Last ${filters.days} days` : "All time"],
        ["Filter: Model", filters.model ?? "All models"],
        ["Filter: Topic", filters.topic ?? "All topics"],
        ["Total Rows", rows.length],
        ["Powered by", "PromptPulse"],
    ]

    metaRows.forEach(([k, v], i) => {
        const row = meta.getRow(i + 2)
        row.height = 22
        const kCell = row.getCell(1)
        kCell.value = k
        kCell.font = { name: "Calibri", size: 10, bold: true, color: { argb: XL.muted } }
        kCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL.stripe } }
        kCell.alignment = { vertical: "middle", indent: 1 }

        const vCell = row.getCell(2)
        vCell.value = v
        vCell.font = { name: "Calibri", size: 10, bold: false, color: { argb: XL.text } }
        vCell.alignment = { vertical: "middle", indent: 1 }
    })

    // ── Data sheet ────────────────────────────────────────────────────────────
    const ws = wb.addWorksheet("Data", { tabColor: { argb: XL.navy } })

    if (rows.length === 0) {
        ws.getCell("A1").value = "No data for the selected filters."
        return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
    }

    const keys = Object.keys(rows[0])

    // Column definitions — apply width + number format
    ws.columns = keys.map((k, i) => {
        const meta = COL[k]
        return {
            key: k,
            width: meta?.width ?? 18,
            style: {
                numFmt: meta?.numFmt,
                alignment: { horizontal: meta?.align ?? "left", vertical: "middle" as const, wrapText: false },
            },
        }
    })

    // ── Header row ────────────────────────────────────────────────────────────
    const headerRow = ws.getRow(1)
    headerRow.height = 28

    keys.forEach((k, colIdx) => {
        const cell = headerRow.getCell(colIdx + 1)
        const m = COL[k]
        cell.value = m?.label ?? toTitle(k)
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: XL.white } }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL.navy } }
        cell.alignment = { horizontal: m?.align ?? "left", vertical: "middle", wrapText: false, indent: 1 }
        cell.border = {
            bottom: { style: "medium", color: { argb: XL.blue } },
        }
    })

    // ── Section grouping (overview only) ─────────────────────────────────────
    const sections = resource === "overview" ? groupBySection(rows) : null

    if (sections) {
        let rowIdx = 2
        for (const [sectionName, sectionRows] of sections) {
            // Section header row
            const secRow = ws.getRow(rowIdx)
            secRow.height = 22
            ws.mergeCells(`A${rowIdx}:${colLetter(keys.length)}${rowIdx}`)
            const secCell = secRow.getCell(1)
            secCell.value = sectionName.toUpperCase()
            secCell.font = { name: "Calibri", size: 9, bold: true, color: { argb: XL.blue } }
            secCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: XL.sectionBg } }
            secCell.alignment = { horizontal: "left", vertical: "middle", indent: 2 }
            rowIdx++

            for (const [i, rowData] of sectionRows.entries()) {
                const xlRow = ws.getRow(rowIdx)
                xlRow.height = 20
                addDataRow(xlRow, keys, rowData, i, true)
                rowIdx++
            }
            // Blank gap between sections
            rowIdx++
        }
    } else {
        rows.forEach((rowData, i) => {
            const xlRow = ws.getRow(i + 2)
            xlRow.height = 20
            addDataRow(xlRow, keys, rowData, i, false)
        })
    }

    // ── Freeze header + auto-filter ───────────────────────────────────────────
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 1, topLeftCell: "A2", activeCell: "A2" }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } }

    // ── Set workbook active sheet ─────────────────────────────────────────────
    wb.views = [{ activeTab: 1 }]  // "Data" sheet active on open

    return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
}

function addDataRow(
    xlRow: ExcelJS.Row,
    keys: string[],
    rowData: CsvRow,
    rowIdx: number,
    inSection: boolean,
): void {
    const isStripe = rowIdx % 2 === 0
    const bg = isStripe ? XL.stripe : XL.white

    keys.forEach((k, colIdx) => {
        const cell = xlRow.getCell(colIdx + 1)
        const meta = COL[k]
        const raw = rowData[k]
        const value = cellValue(raw)

        cell.value = value
        cell.font = { name: "Calibri", size: 10, color: { argb: XL.text } }
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }
        cell.alignment = {
            horizontal: meta?.align ?? "left",
            vertical: "middle",
            wrapText: false,
            indent: 1,
        }
        if (meta?.numFmt && typeof value === "number") {
            cell.numFmt = meta.numFmt
        }
        // Bottom hairline
        cell.border = { bottom: { style: "hair", color: { argb: XL.border } } }
    })
}

function cellValue(raw: CsvValue | CsvValue[]): string | number | boolean | Date {
    if (Array.isArray(raw)) return raw.join(", ")
    if (raw instanceof Date) return raw                  // ExcelJS handles dates natively
    if (typeof raw === "boolean") return raw ? "Yes" : "No"
    if (raw == null) return ""
    if (typeof raw === "number") return raw
    return String(raw)
}

function groupBySection(rows: CsvRow[]): Map<string, CsvRow[]> {
    const map = new Map<string, CsvRow[]>()
    for (const row of rows) {
        const sec = String(row.section ?? "Other")
        if (!map.has(sec)) map.set(sec, [])
        map.get(sec)!.push(row)
    }
    return map
}

function colLetter(n: number): string {
    // 1→A, 26→Z, 27→AA
    let result = ""
    while (n > 0) {
        result = String.fromCharCode(65 + ((n - 1) % 26)) + result
        n = Math.floor((n - 1) / 26)
    }
    return result
}

// ─── CSV fallback ─────────────────────────────────────────────────────────────

function rowsToCsv(rows: CsvRow[]): string {
    if (rows.length === 0) return "\uFEFF"
    const keys = Object.keys(rows[0])
    const headers = keys.map(k => COL[k]?.label ?? toTitle(k))
    const lines = [
        headers.map(csvEsc).join(","),
        ...rows.map(row => keys.map(k => csvEsc(serializeCsv(row[k]))).join(",")),
    ]
    return `\uFEFF${lines.join("\r\n")}\r\n`
}

function serializeCsv(v: CsvValue | CsvValue[]): string {
    if (Array.isArray(v)) return v.join("; ")
    if (v instanceof Date) return fmtDate(v)
    if (typeof v === "boolean") return v ? "Yes" : "No"
    if (v == null) return ""
    return String(v)
}

function csvEsc(text: string): string {
    if (!/[",\n\r]/.test(text)) return text
    return `"${text.replace(/"/g, '""')}"`
}

// ─── PDF builder ─────────────────────────────────────────────────────────────

const PDF_RESOURCE_SUBTITLE: Record<ExportResource, string> = {
    overview: "Brand visibility, competitive landscape & source intelligence",
    prompts: "Performance breakdown of every tracked prompt",
    chats: "Raw AI responses with brand & sentiment data",
    sources: "Domains & citations influencing AI answers",
    competitors: "Visibility & sentiment for tracked competitors",
    "web-analytics": "Session events, referrers & visitor behaviour",
}

const SKIP_PDF = new Set(["prompt_id", "chat_id", "source_id", "competitor_id", "event_id", "raw_response", "snippet", "url"])

async function buildPdf(
    brandName: string,
    resource: ExportResource,
    filters: ExportFilters,
    rows: CsvRow[],
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 0, size: "A4", bufferPages: true })
        const chunks: Buffer[] = []
        doc.on("data", c => chunks.push(c))
        doc.on("end", () => resolve(Buffer.concat(chunks)))
        doc.on("error", reject)

        const W = doc.page.width   // 595.28 pt for A4
        const margin = 40

        // ── Header bar ───────────────────────────────────────────────────────
        doc.rect(0, 0, W, 88).fill(PDF.navy)

        // Brand name — small label above title
        doc.fillColor(PDF.blue).fontSize(9).font("Helvetica-Bold")
        doc.text(brandName.toUpperCase(), margin, 20, { characterSpacing: 2 })

        // Report title
        doc.fillColor(PDF.white).fontSize(22).font("Helvetica-Bold")
        doc.text(RESOURCE_LABEL[resource], margin, 34)

        // Subtitle
        doc.fillColor("#94A3B8").fontSize(9).font("Helvetica")
        doc.text(PDF_RESOURCE_SUBTITLE[resource], margin, 62)

        // Date top-right
        const dateStr = fmtDate(new Date())
        doc.fillColor("#64748B").fontSize(8.5).font("Helvetica")
        doc.text(dateStr, W - margin - 120, 20, { width: 120, align: "right" })

        // Filter pill
        if (filters.days) {
            const pill = `Last ${filters.days} days`
            doc.roundedRect(W - margin - 80, 32, 80, 16, 4).fill("#1A3A5C")
            doc.fillColor("#93C5FD").fontSize(8).font("Helvetica")
            doc.text(pill, W - margin - 78, 36, { width: 76, align: "center" })
        }

        let y = 106

        // ── Body ─────────────────────────────────────────────────────────────
        if (resource === "overview") {
            y = renderOverviewBody(doc, rows, W, margin, y)
        } else {
            y = renderGenericTable(doc, rows, W, margin, y)
        }

        // ── Footers on all pages ──────────────────────────────────────────────
        const total = (doc as unknown as { bufferedPageRange(): { count: number } }).bufferedPageRange().count
        for (let i = 0; i < total; i++) {
            doc.switchToPage(i)
            renderFooter(doc, brandName, i + 1, total, W, margin)
        }

        doc.end()
    })
}

function renderOverviewBody(doc: PDFKit.PDFDocument, rows: CsvRow[], W: number, margin: number, y: number): number {
    const summaryRows = rows.filter(r => r.section === "Summary")
    const brandRows = rows.filter(r => r.section === "Brands")
    const sourceRows = rows.filter(r => r.section === "Sources")

    y = pdfSectionHeader(doc, "Executive Summary", W, margin, y)
    y = renderKpiCards(doc, summaryRows, W, margin, y)
    y += 18

    y = pdfSectionHeader(doc, "Brand Visibility Rankings", W, margin, y)
    y = renderTable(doc, {
        headers: ["#", "Brand", "Visibility", "Avg. Position", "Avg. Sentiment"],
        colWidths: [28, 180, 88, 100, 100],
        rows: brandRows.map(r => [
            String(r.rank ?? ""),
            String(r.item ?? ""),
            `${r.value}%`,
            String(r.detail).match(/Pos: ([^\s|]+)/)?.[1] ?? "–",
            String(r.detail).match(/Sent: ([^\s]+)/)?.[1] ?? "–",
        ]),
        align: ["center", "left", "center", "center", "center"],
        W, margin,
    }, y)
    y += 18

    y = pdfSectionHeader(doc, "Top Influencing Sources", W, margin, y)
    y = renderTable(doc, {
        headers: ["#", "Domain", "Used %", "Type", "Avg. Citations"],
        colWidths: [28, 200, 78, 120, 78],
        rows: sourceRows.map(r => [
            String(r.rank ?? ""),
            String(r.item ?? ""),
            `${r.value}%`,
            String(r.detail).split(" | ")[0] ?? "–",
            String(r.detail).match(/Avg citations: ([^\s]+)/)?.[1] ?? "–",
        ]),
        align: ["center", "left", "center", "center", "center"],
        W, margin,
    }, y)

    return y
}

function renderGenericTable(doc: PDFKit.PDFDocument, rows: CsvRow[], W: number, margin: number, y: number): number {
    if (rows.length === 0) {
        doc.fillColor(PDF.muted).fontSize(11).font("Helvetica")
        doc.text("No data available for the selected filters.", margin, y + 20)
        return y + 60
    }

    const keys = Object.keys(rows[0]).filter(k => !SKIP_PDF.has(k)).slice(0, 7)
    const usable = W - margin * 2
    const colWidths = allocateColWidths(keys, usable)

    const align: ("left" | "center")[] = keys.map(k =>
        ["rank", "visibility_pct", "avg_position", "avg_sentiment", "mentions", "total_chats", "used_pct", "duration_ms", "cited", "used_by_ai", "brand_mentioned"].includes(k)
            ? "center" : "left"
    )

    const tableRows = rows.slice(0, 200).map(row =>
        keys.map(k => {
            const v = row[k]
            if (Array.isArray(v)) return v.slice(0, 3).join(", ")
            if (v instanceof Date) return fmtDate(v)
            if (typeof v === "boolean") return v ? "Yes" : "No"
            if (v == null) return "–"
            const s = String(v)
            return s.length > 42 ? `${s.slice(0, 40)}…` : s
        })
    )

    const headers = keys.map(k => COL[k]?.label ?? toTitle(k))
    return renderTable(doc, { headers, colWidths, rows: tableRows, align, W, margin }, y)
}

function allocateColWidths(keys: string[], total: number): number[] {
    const base = Math.floor(total / keys.length)
    const widths = keys.map(k => {
        const meta = COL[k]
        if (!meta) return base
        // Scale from the metadata hint
        return Math.max(base * 0.6, Math.min(meta.width * 6.5, total * 0.35))
    })
    // normalise to exactly fill total
    const sum = widths.reduce((s, w) => s + w, 0)
    const ratio = total / sum
    return widths.map(w => Math.floor(w * ratio))
}

// ─── PDF Primitives ───────────────────────────────────────────────────────────

function pdfSectionHeader(doc: PDFKit.PDFDocument, title: string, W: number, margin: number, y: number): number {
    doc.rect(margin, y, W - margin * 2, 24).fill("#EFF6FF")
    doc.rect(margin, y, 3, 24).fill(PDF.blue)
    doc.fillColor(PDF.blue).fontSize(9.5).font("Helvetica-Bold")
    doc.text(title.toUpperCase(), margin + 10, y + 8, { characterSpacing: 0.4 })
    return y + 32
}

interface TableSpec {
    headers: string[]
    colWidths: number[]
    rows: string[][]
    align: ("left" | "center")[]
    W: number
    margin: number
}

function renderTable(doc: PDFKit.PDFDocument, spec: TableSpec, startY: number): number {
    const { headers, colWidths, rows, align, W, margin } = spec
    const rowH = 21
    const headerH = 25
    const pageH = doc.page.height
    const footerRs = 48

    let y = startY

    const drawHeader = (yy: number) => {
        doc.rect(margin, yy, W - margin * 2, headerH).fill("#1E293B")
        let x = margin
        headers.forEach((h, i) => {
            doc.fillColor("#94A3B8").fontSize(8).font("Helvetica-Bold")
            const opts = align[i] === "center"
                ? { width: colWidths[i] - 8, align: "center" as const }
                : { width: colWidths[i] - 8 }
            doc.text(h.toUpperCase(), x + 4, yy + 9, opts)
            x += colWidths[i]
        })
    }

    drawHeader(y)
    y += headerH

    rows.forEach((row, ri) => {
        if (y + rowH > pageH - footerRs) {
            doc.addPage()
            y = 48
            drawHeader(y)
            y += headerH
        }

        if (ri % 2 === 0) {
            doc.rect(margin, y, W - margin * 2, rowH).fill(PDF.stripe)
        }

        let x = margin
        row.forEach((cell, ci) => {
            doc.fillColor(PDF.text).fontSize(8.5).font("Helvetica")
            const colW = colWidths[ci]
            const opts = align[ci] === "center"
                ? { width: colW - 8, align: "center" as const, lineBreak: false }
                : { width: colW - 8, lineBreak: false }
            doc.text(cell, x + 4, y + 6, opts)
            x += colW
        })

        doc.moveTo(margin, y + rowH)
            .lineTo(W - margin, y + rowH)
            .strokeColor("#E2E8F0").lineWidth(0.3).stroke()

        y += rowH
    })

    // Outer border
    doc.rect(margin, startY, W - margin * 2, y - startY)
        .strokeColor("#CBD5E1").lineWidth(0.6).stroke()

    return y + 14
}

function renderKpiCards(doc: PDFKit.PDFDocument, rows: CsvRow[], W: number, margin: number, y: number): number {
    const cols = Math.min(rows.length, 3)
    const cardW = Math.floor((W - margin * 2 - (cols - 1) * 10) / cols)
    const cardH = 66

    rows.forEach((row, i) => {
        const col = i % cols
        const rowN = Math.floor(i / cols)
        const cx = margin + col * (cardW + 10)
        const cy = y + rowN * (cardH + 10)

        // card shell
        doc.roundedRect(cx, cy, cardW, cardH, 5).fill(PDF.white)
        doc.roundedRect(cx, cy, cardW, cardH, 5).strokeColor("#E2E8F0").lineWidth(0.5).stroke()
        // top accent
        doc.rect(cx, cy, cardW, 3).fill(PDF.blue)
        // metric label
        doc.fillColor(PDF.muted).fontSize(7.5).font("Helvetica-Bold")
        doc.text(String(row.item ?? "").toUpperCase(), cx + 10, cy + 10, { width: cardW - 20, characterSpacing: 0.3 })
        // value
        doc.fillColor("#0F172A").fontSize(22).font("Helvetica-Bold")
        doc.text(String(row.value ?? ""), cx + 10, cy + 24, { width: cardW - 20 })
        // description
        doc.fillColor(PDF.muted).fontSize(7.5).font("Helvetica")
        doc.text(String(row.detail ?? ""), cx + 10, cy + 52, { width: cardW - 20, lineBreak: false })
    })

    const rowCount = Math.ceil(rows.length / cols)
    return y + rowCount * (cardH + 10) + 6
}

function renderFooter(doc: PDFKit.PDFDocument, brandName: string, page: number, total: number, W: number, margin: number) {
    const H = doc.page.height
    const fy = H - 28

    doc.moveTo(margin, fy - 8).lineTo(W - margin, fy - 8)
        .strokeColor("#E2E8F0").lineWidth(0.5).stroke()

    doc.fillColor(PDF.muted).fontSize(7.5).font("Helvetica")
    doc.text(`Confidential — Generated for ${brandName}`, margin, fy, { lineBreak: false })

    doc.fillColor(PDF.muted).fontSize(7.5).font("Helvetica-Bold")
    doc.text("PromptPulse", 0, fy, { align: "center", lineBreak: false })

    const pgText = `Page ${page} of ${total}`
    const pgW = doc.widthOfString(pgText, { fontSize: 7.5 })
    doc.fillColor(PDF.muted).fontSize(7.5).font("Helvetica")
    doc.text(pgText, W - margin - pgW, fy, { lineBreak: false })
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function buildFilename(brandName: string, resource: ExportResource, ext: string) {
    const brand = slugify(brandName || "project")
    const date = new Date().toISOString().slice(0, 10)
    return `${brand}-${resource}-${date}.${ext}`
}

function slugify(v: string) {
    return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

function daysAgo(days: number) { return new Date(Date.now() - days * 86400000) }

function average(values: Array<number | null | undefined>) {
    const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    if (clean.length === 0) return ""
    return round2(clean.reduce((s, v) => s + v, 0) / clean.length)
}

function pct(part: number, total: number) { return round2((part / total) * 100) }
function round2(n: number) { return Number(n.toFixed(2)) }

function fmtDate(d: Date): string {
    return d.toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false,
    }) + " UTC"
}

function toTitle(key: string): string {
    return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

async function buildGeoArticlePdfKit(
    brandName: string,
    brief: any,
    article: any
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 0, size: "A4", bufferPages: true })
        const chunks: Buffer[] = []
        doc.on("data", c => chunks.push(c))
        doc.on("end", () => resolve(Buffer.concat(chunks)))
        doc.on("error", reject)

        const W = doc.page.width
        const H = doc.page.height
        const margin = 42
        const contentW = W - margin * 2

        // Top Accent Bar
        doc.rect(0, 0, W, 4).fill("#D97706")

        // Header Background
        doc.rect(0, 4, W, 96).fill("#0F172A")

        // Eyebrow
        doc.fillColor("#D97706").fontSize(8.5).font("Helvetica-Bold")
        doc.text(`${brandName.toUpperCase()} · AI VISIBILITY INTELLIGENCE & GEO CONTENT BRIEF`, margin, 18, { characterSpacing: 1.5 })

        // Title
        const mainTitle = article.title ?? brief.recommended_article.title
        doc.fillColor("#FFFFFF").fontSize(16).font("Helvetica-Bold")
        doc.text(mainTitle, margin, 32, { width: contentW - 90, height: 38, ellipsis: true })

        // Subtitle / Meta description
        const subDesc = article.meta_description ?? brief.recommended_article.priority_reason
        if (subDesc) {
            doc.fillColor("#94A3B8").fontSize(8.5).font("Helvetica")
            doc.text(subDesc, margin, 72, { width: contentW - 90, height: 20, ellipsis: true })
        }

        // Date
        const dateStr = fmtDate(new Date())
        doc.fillColor("#64748B").fontSize(8).font("Helvetica")
        doc.text(dateStr, W - margin - 120, 18, { width: 120, align: "right" })

        // Action badge
        const action = brief.recommended_article?.action ?? "CREATE"
        const badgeBg = action === "CREATE" ? "#065F46" : action === "REFRESH" ? "#92400E" : "#334155"
        const badgeText = action === "CREATE" ? "#34D399" : action === "REFRESH" ? "#FBBF24" : "#CBD5E1"
        doc.roundedRect(W - margin - 85, 34, 85, 18, 4).fill(badgeBg)
        doc.fillColor(badgeText).fontSize(8).font("Helvetica-Bold")
        doc.text(action + " PAGE", W - margin - 85, 39, { width: 85, align: "center", characterSpacing: 1 })

        let y = 114

        // ─── Executive KPI Cards ──────────────────────────────────────────
        const m = brief.metrics ?? { own_visibility: 0, evidence_count: 0 }
        const gapVal = 100 - (m.own_visibility ?? 0)
        const kpis = [
            { label: "AI VISIBILITY", value: `${m.own_visibility}%`, color: "#059669", bg: "#ECFDF5", border: "#A7F3D0" },
            { label: "COMPETITOR GAP", value: `${gapVal.toFixed(1)}%`, color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
            { label: "AVG POSITION", value: m.own_avg_position ? `#${m.own_avg_position}` : "—", color: "#0284C7", bg: "#F0F9FF", border: "#BAE6FD" },
            { label: "EVIDENCE POINTS", value: String(m.evidence_count), color: "#4F46E5", bg: "#EEF2FF", border: "#C7D2FE" }
        ]

        const kpiGap = 10
        const kpiW = (contentW - kpiGap * 3) / 4
        kpis.forEach((kpi, i) => {
            const kX = margin + i * (kpiW + kpiGap)
            doc.roundedRect(kX, y, kpiW, 46, 5).fill(kpi.bg)
            doc.roundedRect(kX, y, kpiW, 46, 5).lineWidth(1).strokeColor(kpi.border).stroke()

            doc.fillColor("#64748B").fontSize(7.5).font("Helvetica-Bold")
            doc.text(kpi.label, kX + 10, y + 8, { characterSpacing: 0.8 })

            doc.fillColor(kpi.color).fontSize(15).font("Helvetica-Bold")
            doc.text(kpi.value, kX + 10, y + 21)
        })

        y += 58

        // ─── Target Query Context Box ────────────────────────────────────
        if (brief.target_prompt?.text) {
            doc.roundedRect(margin, y, contentW, 36, 5).fill("#F8FAFC")
            doc.roundedRect(margin, y, contentW, 36, 5).lineWidth(1).strokeColor("#E2E8F0").stroke()

            doc.fillColor("#D97706").fontSize(7.5).font("Helvetica-Bold")
            doc.text("TARGET BUYER QUERY", margin + 12, y + 7, { characterSpacing: 1 })

            doc.fillColor("#0F172A").fontSize(9.5).font("Helvetica-Bold")
            doc.text(`"${brief.target_prompt.text}"`, margin + 12, y + 18, { width: contentW - 24, ellipsis: true })

            y += 46
        }

        // Helper to check page break
        function ensurePageSpace(neededHeight: number) {
            if (y + neededHeight > H - 55) {
                doc.addPage()
                // Mini page header
                doc.rect(0, 0, W, 22).fill("#0F172A")
                doc.fillColor("#94A3B8").fontSize(7.5).font("Helvetica-Bold")
                doc.text(`${brandName.toUpperCase()} · GEO ARTICLE DRAFT`, margin, 7, { characterSpacing: 1 })
                doc.fillColor("#64748B").fontSize(7.5).font("Helvetica")
                doc.text(dateStr, W - margin - 100, 7, { width: 100, align: "right" })
                y = margin + 8
            }
        }

        // ─── Markdown Content Rendering with Table & Callout Support ─────
        if (article.article_markdown) {
            const rawLines = article.article_markdown.split("\n")
            let tableBuffer: string[] = []

            function flushTable() {
                if (tableBuffer.length === 0) return
                const rows = tableBuffer
                    .map(r => r.split("|").map(cell => cell.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1))
                    .filter(r => r.length > 0 && !r.every(c => /^[-:]+$/.test(c)))

                tableBuffer = []
                if (rows.length === 0) return

                const colCount = Math.max(...rows.map(r => r.length))
                if (colCount === 0) return
                const colW = contentW / colCount
                const rowH = 20

                ensurePageSpace(rows.length * rowH + 16)
                y += 6

                rows.forEach((row, rowIndex) => {
                    const isHeader = rowIndex === 0
                    ensurePageSpace(rowH)

                    if (isHeader) {
                        doc.rect(margin, y, contentW, rowH).fill("#0F172A")
                    } else {
                        doc.rect(margin, y, contentW, rowH).fill(rowIndex % 2 === 0 ? "#FFFFFF" : "#F8FAFC")
                        doc.rect(margin, y, contentW, rowH).lineWidth(0.5).strokeColor("#E2E8F0").stroke()
                    }

                    row.forEach((cellText, colIndex) => {
                        const cellX = margin + colIndex * colW
                        doc.fillColor(isHeader ? "#FFFFFF" : "#1E293B")
                           .fontSize(isHeader ? 8.5 : 8.5)
                           .font(isHeader ? "Helvetica-Bold" : "Helvetica")
                        doc.text(cellText.replace(/\*\*/g, ""), cellX + 6, y + 5, { width: colW - 12, ellipsis: true })
                    })

                    y += rowH
                })

                y += 10
            }

            for (let i = 0; i < rawLines.length; i++) {
                const line = rawLines[i].trim()

                // Table parsing
                if (line.startsWith("|")) {
                    tableBuffer.push(line)
                    continue
                } else if (tableBuffer.length > 0) {
                    flushTable()
                }

                if (!line) {
                    y += 4
                    continue
                }

                // Callouts: [NEEDS DATA: ...]
                if (line.includes("[NEEDS DATA:")) {
                    const cleanCallout = line.replace(/\[NEEDS DATA:\s*/i, "").replace(/\]/g, "")
                    ensurePageSpace(46)
                    doc.roundedRect(margin, y, contentW, 40, 4).fill("#FEF3C7")
                    doc.roundedRect(margin, y, contentW, 40, 4).lineWidth(1).strokeColor("#F59E0B").stroke()

                    doc.fillColor("#92400E").fontSize(7.5).font("Helvetica-Bold")
                    doc.text("EDITORIAL REVIEW REQUIRED", margin + 10, y + 7, { characterSpacing: 1 })

                    doc.fillColor("#78350F").fontSize(8.5).font("Helvetica")
                    doc.text(cleanCallout, margin + 10, y + 19, { width: contentW - 20, height: 18, ellipsis: true })

                    y += 48
                    continue
                }

                // Headings
                if (line.startsWith("# ")) {
                    ensurePageSpace(32)
                    y += 8
                    doc.fillColor("#0F172A").fontSize(14).font("Helvetica-Bold")
                    doc.text(line.replace(/^#+ /, ""), margin, y, { width: contentW })
                    y += 20
                } else if (line.startsWith("## ")) {
                    ensurePageSpace(30)
                    y += 12
                    doc.fillColor("#0F172A").fontSize(12).font("Helvetica-Bold")
                    doc.text(line.replace(/^#+ /, ""), margin, y, { width: contentW })
                    y += 16
                    doc.moveTo(margin, y).lineTo(W - margin, y).lineWidth(0.75).strokeColor("#E2E8F0").stroke()
                    y += 8
                } else if (line.startsWith("### ")) {
                    ensurePageSpace(24)
                    y += 8
                    doc.fillColor("#1E293B").fontSize(10.5).font("Helvetica-Bold")
                    doc.text(line.replace(/^#+ /, ""), margin, y, { width: contentW })
                    y += 15
                } else if (line.startsWith("- ") || line.startsWith("* ")) {
                    const bulletText = line.replace(/^[-*] /, "").replace(/\*\*/g, "")
                    const height = doc.heightOfString(bulletText, { width: contentW - 18 })
                    ensurePageSpace(height + 4)
                    doc.fillColor("#0F172A").fontSize(9).font("Helvetica-Bold")
                    doc.text("•", margin + 4, y)
                    doc.fillColor("#334155").fontSize(9).font("Helvetica")
                    doc.text(bulletText, margin + 16, y, { width: contentW - 18, lineGap: 2.5 })
                    y += height + 4
                } else {
                    const text = line.replace(/\*\*/g, "").replace(/`/g, "")
                    const height = doc.heightOfString(text, { width: contentW })
                    ensurePageSpace(height + 6)
                    doc.fillColor("#334155").fontSize(9.5).font("Helvetica")
                    doc.text(text, margin, y, { width: contentW, lineGap: 3.5 })
                    y += height + 6
                }
            }

            if (tableBuffer.length > 0) {
                flushTable()
            }
        }

        // ─── FAQ Section ─────────────────────────────────────────────────
        if (article.faq && article.faq.length > 0) {
            ensurePageSpace(45)
            y += 14
            doc.fillColor("#0F172A").fontSize(12).font("Helvetica-Bold")
            doc.text("Frequently Asked Questions (FAQ Schema)", margin, y)
            y += 16
            doc.moveTo(margin, y).lineTo(W - margin, y).lineWidth(0.75).strokeColor("#E2E8F0").stroke()
            y += 10

            for (const f of article.faq) {
                const qH = doc.heightOfString(f.question, { width: contentW - 24 })
                const aH = doc.heightOfString(f.answer, { width: contentW - 24 })
                const totalBoxH = qH + aH + 20

                ensurePageSpace(totalBoxH + 6)
                doc.roundedRect(margin, y, contentW, totalBoxH, 5).fill("#F8FAFC")
                doc.roundedRect(margin, y, contentW, totalBoxH, 5).lineWidth(1).strokeColor("#E2E8F0").stroke()

                doc.fillColor("#0F172A").fontSize(9).font("Helvetica-Bold")
                doc.text(f.question, margin + 12, y + 8, { width: contentW - 24 })

                doc.fillColor("#475569").fontSize(8.5).font("Helvetica")
                doc.text(f.answer, margin + 12, y + 8 + qH + 4, { width: contentW - 24, lineGap: 2 })

                y += totalBoxH + 8
            }
        }

        // ─── Footers across all pages ────────────────────────────────────
        const total = (doc as any).bufferedPageRange().count
        for (let i = 0; i < total; i++) {
            doc.switchToPage(i)
            // Bottom rule
            doc.moveTo(margin, H - 36).lineTo(W - margin, H - 36).lineWidth(0.5).strokeColor("#E2E8F0").stroke()

            // Footer text
            doc.fillColor("#94A3B8").fontSize(8).font("Helvetica")
            doc.text(`${brandName} · GEO Intelligence & Content Brief · Confidential`, margin, H - 28)
            doc.text(`Page ${i + 1} of ${total}`, W - margin - 80, H - 28, { width: 80, align: "right" })
        }

        doc.end()
    })
}
