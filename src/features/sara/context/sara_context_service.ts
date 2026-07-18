import { buildSaraInternalMcpPacket, type SaraInternalMcpPacket } from "../internal_mcp"

export type SaraContextPacket = SaraInternalMcpPacket

export async function buildSaraContextPacket(input: {
    user_id: string
    project_id: string
    page_context?: string
}): Promise<SaraContextPacket> {
    return buildSaraInternalMcpPacket(input)
}
