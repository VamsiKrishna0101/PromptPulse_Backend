import prisma from "../../lib/prisma"
import { getAgencyContext, assertAgencyManager } from "./agency_service"

export type AgencyBrandingInput = {
    brand_name?: string
    logo_url?: string
    favicon_url?: string
    primary_color?: string
    accent_color?: string
    portal_title?: string
    support_email?: string
    custom_cname?: string
    footer_text?: string
    enable_white_label?: boolean
}

export async function getAgencyBranding(userId: string) {
    const context = await getAgencyContext(userId)
    if (!context) throw Object.assign(new Error("Agency account or access required"), { status: 403 })

    const branding = await prisma.agencyBranding.findUnique({
        where: { agency_user_id: context.agency_user_id },
    })

    if (!branding) {
        return {
            id: "",
            agency_user_id: context.agency_user_id,
            brand_name: "Agency Portal",
            logo_url: null,
            favicon_url: null,
            primary_color: "#2563eb",
            accent_color: "#0f172a",
            portal_title: "Client Intelligence Portal",
            support_email: null,
            custom_cname: null,
            footer_text: "Powered by Agency Intelligence Suite",
            enable_white_label: false,
            created_at: new Date(),
            updated_at: new Date(),
        }
    }

    return branding
}

export async function upsertAgencyBranding(actorUserId: string, input: AgencyBrandingInput) {
    const context = await assertAgencyManager(actorUserId)

    return prisma.agencyBranding.upsert({
        where: { agency_user_id: context.agency_user_id },
        create: {
            agency_user_id: context.agency_user_id,
            brand_name: input.brand_name?.trim() || "Agency Portal",
            logo_url: input.logo_url?.trim() || null,
            favicon_url: input.favicon_url?.trim() || null,
            primary_color: input.primary_color?.trim() || "#2563eb",
            accent_color: input.accent_color?.trim() || "#0f172a",
            portal_title: input.portal_title?.trim() || "Client Intelligence Portal",
            support_email: input.support_email?.trim() || null,
            custom_cname: input.custom_cname?.trim() || null,
            footer_text: input.footer_text?.trim() || "Powered by Agency Intelligence Suite",
            enable_white_label: input.enable_white_label ?? true,
        },
        update: {
            brand_name: input.brand_name !== undefined ? (input.brand_name?.trim() || null) : undefined,
            logo_url: input.logo_url !== undefined ? (input.logo_url?.trim() || null) : undefined,
            favicon_url: input.favicon_url !== undefined ? (input.favicon_url?.trim() || null) : undefined,
            primary_color: input.primary_color !== undefined ? (input.primary_color?.trim() || "#2563eb") : undefined,
            accent_color: input.accent_color !== undefined ? (input.accent_color?.trim() || "#0f172a") : undefined,
            portal_title: input.portal_title !== undefined ? (input.portal_title?.trim() || null) : undefined,
            support_email: input.support_email !== undefined ? (input.support_email?.trim() || null) : undefined,
            custom_cname: input.custom_cname !== undefined ? (input.custom_cname?.trim() || null) : undefined,
            footer_text: input.footer_text !== undefined ? (input.footer_text?.trim() || null) : undefined,
            enable_white_label: input.enable_white_label !== undefined ? input.enable_white_label : undefined,
        },
    })
}
