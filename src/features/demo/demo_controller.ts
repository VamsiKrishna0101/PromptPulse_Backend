import type { Request, Response } from "express"
import { z } from "zod"
import { bookDemo, getPendingDemos } from "./demo_service"

const createDemoSchema = z.object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(120, "Name is too long"),
    email: z.string().trim().email("Invalid email address"),
    company: z.string().trim().max(160, "Company name is too long").optional(),
    notes: z.string().trim().max(2000, "Notes are too long").optional(),
    scheduledAt: z.coerce.date(),
    timezone: z.string().trim().min(2, "Timezone is required").max(80, "Timezone is too long"),
})

function firstError(error: z.ZodError) {
    return Object.values(error.flatten().fieldErrors).flat().find(Boolean) ?? "Invalid demo booking payload"
}

export async function bookDemoController(req: Request, res: Response): Promise<void> {
    const parsed = createDemoSchema.safeParse(req.body)

    if (!parsed.success) {
        res.status(400).json({
            success: false,
            error: firstError(parsed.error),
            errors: parsed.error.flatten().fieldErrors,
        })
        return
    }

    try {
        const demo = await bookDemo(parsed.data)

        res.status(201).json({
            success: true,
            demo,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to book demo"
        const statusCode =
            message === "You have already booked a demo for this time" ? 409 :
            message === "Only work/business email addresses are allowed." ? 422 :
            message === "Demo time must be scheduled in the future" ? 400 :
            500

        res.status(statusCode).json({
            success: false,
            error: message,
        })
    }
}

export async function getPendingDemosController(_req: Request, res: Response): Promise<void> {
    try {
        const demos = await getPendingDemos()

        res.status(200).json({
            success: true,
            demos,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get pending demos"
        res.status(500).json({
            success: false,
            error: message,
        })
    }
}
