import type { Plan } from "@prisma/client"

export type InternalMcpSection = {
    title: string
    lines: Array<string | null | undefined | false>
}

export type InternalMcpToolResult<TData> = {
    tool_name: string
    title: string
    data: TData
    section: InternalMcpSection
}

export type SaraPlanToolData = {
    plan: Plan
    sara_level: "basic" | "full" | "advanced"
    guidance: string
}

export type SaraProjectToolData = {
    brand_name: string
    brand_url: string
    brand_location: string
    tracked_competitors: string[]
}

export type SaraInternalMcpPacket = {
    text: string
    plan: SaraPlanToolData
    project: SaraProjectToolData
    debug: {
        tool_names: string[]
        section_titles: string[]
    }
}
