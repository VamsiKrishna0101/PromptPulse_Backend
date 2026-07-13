import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { createHelpCenterTicket, getUserTickets } from "./help_service"

const createTicketSchema = z.object({
    email: z.string().email("Invalid email address"),
    subject: z.string().trim().min(3, "Subject must be at least 3 characters").max(160, "Subject is too long"),
    message: z.string().trim().min(10, "Message must be at least 10 characters").max(5000, "Message is too long"),
})

export async function createTicketController(req: Request, res: Response): Promise<void> {
    const parsed = createTicketSchema.safeParse(req.body)
    if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors
        const firstError = Object.values(fieldErrors).flat().find(Boolean)

        res.status(400).json({
            success: false,
            error: firstError ?? "Invalid help ticket payload",
            errors: fieldErrors,
        })
        return
    }

    try {
        const user_id = (req as AuthenticatedRequest).user.id
        const ticket = await createHelpCenterTicket(parsed.data, user_id)

        res.status(201).json({
            success: true,
            ticket,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create help ticket"
        res.status(500).json({ success: false, error: message })
    }
}

export async function getTicketsController(req: Request, res: Response): Promise<void> {
    try {
        const user_id = (req as AuthenticatedRequest).user.id
        const tickets = await getUserTickets(user_id)

        res.status(200).json({
            success: true,
            tickets,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get help tickets"
        res.status(500).json({ success: false, error: message })
    }
}
