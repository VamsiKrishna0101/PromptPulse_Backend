export type ExportResource =
    | "overview"
    | "prompts"
    | "chats"
    | "sources"
    | "competitors"
    | "web-analytics"

export type ExportFilters = {
    days?: number
    model?: string
    topic?: string
    status?: string
    q?: string
}

export type ExcelExport = {
    filename: string
    content: Buffer
}

export type CsvExport = {
    filename: string
    content: string
}

export type PdfExport = {
    filename: string
    content: Buffer
}
