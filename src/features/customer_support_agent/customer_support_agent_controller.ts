import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { chatWithCustomerSupportAgent } from "./customer_support_agent_service"

const messageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(3000),
})

const chatSchema = z.object({
    message: z.string().trim().min(1, "Message is required").max(3000, "Message is too long"),
    history: z.array(messageSchema).max(12).optional(),
    project_id: z.string().uuid().nullable().optional(),
})

export async function chatCustomerSupportAgentController(req: Request, res: Response): Promise<void> {
    const parsed = chatSchema.safeParse(req.body)
    if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors
        const firstError = Object.values(fieldErrors).flat().find(Boolean)
        res.status(400).json({
            success: false,
            error: firstError ?? "Invalid support agent payload",
            errors: fieldErrors,
        })
        return
    }

    try {
        const user_id = (req as AuthenticatedRequest).user.id
        const response = await chatWithCustomerSupportAgent(user_id, parsed.data)
        res.status(200).json({
            success: true,
            ...response,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to run support agent"
        const status = message === "PROJECT_NOT_FOUND" ? 404 : 500
        res.status(status).json({
            success: false,
            error: status === 404 ? "Project not found" : message,
        })
    }
}
