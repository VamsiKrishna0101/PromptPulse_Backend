import { z } from "zod"

export const createSiteSchema = z.object({
    name: z.string().min(1).max(120),
    domain: z.string().min(3).max(255),
})

export const updateSiteSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    domain: z.string().min(3).max(255).optional(),
    is_active: z.boolean().optional(),
})

export const collectEventSchema = z.object({
    public_key: z.string().min(10),
    visitor_id: z.string().min(6).max(128).optional(),
    type: z.enum(["PAGE_VIEW", "CUSTOM"]).default("PAGE_VIEW"),
    path: z.string().min(1).max(2048),
    url: z.string().max(4096).optional(),
    title: z.string().max(500).optional(),
    referrer: z.string().max(4096).optional(),
    source: z.string().max(255).optional(),
    language: z.string().min(2).max(12).optional(),
    screen_width: z.number().int().nonnegative().max(100000).optional(),
    screen_height: z.number().int().nonnegative().max(100000).optional(),
    screen_color_depth: z.number().int().nonnegative().max(64).optional(),
    browser_width: z.number().int().nonnegative().max(100000).optional(),
    browser_height: z.number().int().nonnegative().max(100000).optional(),
    event_name: z.string().max(120).optional(),
    event_value: z.unknown().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
})

export const createCustomEventSchema = z.object({
    title: z.string().min(1).max(160),
    type: z.enum(["TOTAL_CHART", "AVERAGE_CHART", "TOTAL_LIST", "AVERAGE_LIST"]).default("TOTAL_CHART"),
    key: z.string().max(120).optional(),
})

export const updateCustomEventSchema = createCustomEventSchema.partial()

export const collectActionSchema = z.object({
    public_key: z.string().min(10),
    event_id: z.string().min(1),
    visitor_id: z.string().min(6).max(128).optional(),
    key: z.string().max(160).optional(),
    value: z.number().default(1),
    details: z.string().max(1000).optional(),
})

export type CreateSiteInput = z.infer<typeof createSiteSchema>
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>
export type CollectEventInput = z.infer<typeof collectEventSchema>
export type CreateCustomEventInput = z.infer<typeof createCustomEventSchema>
export type UpdateCustomEventInput = z.infer<typeof updateCustomEventSchema>
export type CollectActionInput = z.infer<typeof collectActionSchema>

export type AnalyticsRange = {
    from: Date
    to: Date
    days: number
}
