import type { Request, Response } from "express"
import { z } from "zod"
import {
    adminParsers,
    getAdminOverview,
    getAdminUser,
    listAdminProjects,
    listAdminSubscriptions,
    listAdminTickets,
    listAdminUsers,
    setAdminTicketResolved,
} from "./admin_service"

const paginationQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    page_size: z.coerce.number().int().min(1).max(100).optional(),
    q: z.string().trim().optional(),
})

const ticketResolveSchema = z.object({
    is_resolved: z.boolean(),
})

function firstError(error: z.ZodError) {
    return Object.values(error.flatten().fieldErrors).flat().find(Boolean) ?? "Invalid request"
}

function handleAdminError(error: unknown, res: Response, fallback: string) {
    if (error instanceof Error && error.message === "USER_NOT_FOUND") {
        res.status(404).json({ error: "User not found" })
        return
    }
    if (error instanceof Error && error.message === "TICKET_NOT_FOUND") {
        res.status(404).json({ error: "Ticket not found" })
        return
    }

    const message = error instanceof Error ? error.message : fallback
    res.status(500).json({ error: message })
}

export async function getAdminOverviewController(_req: Request, res: Response): Promise<void> {
    try {
        res.status(200).json(await getAdminOverview())
    } catch (error) {
        handleAdminError(error, res, "Failed to get admin overview")
    }
}

export async function listAdminUsersController(req: Request, res: Response): Promise<void> {
    const parsed = paginationQuerySchema.extend({
        plan: z.string().optional(),
        role: z.string().optional(),
    }).safeParse(req.query)

    if (!parsed.success) {
        res.status(400).json({ error: firstError(parsed.error) })
        return
    }

    try {
        res.status(200).json(await listAdminUsers({
            page: parsed.data.page,
            page_size: parsed.data.page_size,
            q: parsed.data.q,
            plan: adminParsers.readPlan(parsed.data.plan),
            role: adminParsers.readRole(parsed.data.role),
        }))
    } catch (error) {
        handleAdminError(error, res, "Failed to list users")
    }
}

export async function getAdminUserController(req: Request, res: Response): Promise<void> {
    try {
        const { user_id } = req.params
        if (!user_id || Array.isArray(user_id)) {
            res.status(400).json({ error: "user_id is required" })
            return
        }

        res.status(200).json(await getAdminUser(user_id))
    } catch (error) {
        handleAdminError(error, res, "Failed to get user")
    }
}

export async function listAdminProjectsController(req: Request, res: Response): Promise<void> {
    const parsed = paginationQuerySchema.safeParse(req.query)
    if (!parsed.success) {
        res.status(400).json({ error: firstError(parsed.error) })
        return
    }

    try {
        res.status(200).json(await listAdminProjects(parsed.data))
    } catch (error) {
        handleAdminError(error, res, "Failed to list projects")
    }
}

export async function listAdminSubscriptionsController(req: Request, res: Response): Promise<void> {
    const parsed = paginationQuerySchema.extend({
        plan: z.string().optional(),
        status: z.string().optional(),
    }).safeParse(req.query)

    if (!parsed.success) {
        res.status(400).json({ error: firstError(parsed.error) })
        return
    }

    try {
        res.status(200).json(await listAdminSubscriptions({
            page: parsed.data.page,
            page_size: parsed.data.page_size,
            q: parsed.data.q,
            plan: adminParsers.readPlan(parsed.data.plan),
            status: adminParsers.readSubscriptionStatus(parsed.data.status),
        }))
    } catch (error) {
        handleAdminError(error, res, "Failed to list subscriptions")
    }
}

export async function listAdminTicketsController(req: Request, res: Response): Promise<void> {
    const parsed = paginationQuerySchema.extend({
        status: z.enum(["open", "resolved", "all"]).optional(),
    }).safeParse(req.query)

    if (!parsed.success) {
        res.status(400).json({ error: firstError(parsed.error) })
        return
    }

    try {
        res.status(200).json(await listAdminTickets({
            page: parsed.data.page,
            page_size: parsed.data.page_size,
            q: parsed.data.q,
            status: parsed.data.status ?? "open",
        }))
    } catch (error) {
        handleAdminError(error, res, "Failed to list tickets")
    }
}

export async function setAdminTicketResolvedController(req: Request, res: Response): Promise<void> {
    const parsed = ticketResolveSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({ error: firstError(parsed.error) })
        return
    }

    try {
        const { ticket_id } = req.params
        if (!ticket_id || Array.isArray(ticket_id)) {
            res.status(400).json({ error: "ticket_id is required" })
            return
        }

        res.status(200).json(await setAdminTicketResolved(ticket_id, parsed.data.is_resolved))
    } catch (error) {
        handleAdminError(error, res, "Failed to update ticket")
    }
}
