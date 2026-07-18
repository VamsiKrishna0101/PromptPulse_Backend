import { getSaraActionTool } from "./action_tool"
import { formatInternalMcpSections } from "./format"
import { getSaraPerformanceTool } from "./performance_tool"
import { getSaraPlanTool } from "./plan_tool"
import { getSaraProjectTool } from "./project_tool"
import { getSaraSourceTool } from "./source_tool"
import type { InternalMcpSection, SaraInternalMcpPacket } from "./types"

export async function buildSaraInternalMcpPacket(input: {
    user_id: string
    project_id: string
    page_context?: string
}): Promise<SaraInternalMcpPacket> {
    const [plan, project, performance, sources, actions] = await Promise.all([
        getSaraPlanTool(input.user_id),
        getSaraProjectTool(input.project_id),
        getSaraPerformanceTool(input.project_id),
        getSaraSourceTool(input.project_id),
        getSaraActionTool(input.project_id, input.user_id),
    ])

    const pageSection: InternalMcpSection = {
        title: "Current Product Surface",
        lines: [
            input.page_context ? `User is asking from: ${input.page_context}` : "User did not provide a page context.",
            "Use the internal MCP live facts first. Use RAG snippets only as supporting evidence.",
        ],
    }

    return {
        plan: plan.data,
        project: project.data,
        debug: {
            tool_names: [plan, project, performance, sources, actions].map(tool => tool.tool_name),
            section_titles: [pageSection, plan.section, project.section, performance.section, sources.section, actions.section]
                .map(section => section.title),
        },
        text: formatInternalMcpSections([
            pageSection,
            plan.section,
            project.section,
            performance.section,
            sources.section,
            actions.section,
        ]),
    }
}

export type { SaraInternalMcpPacket }
