import type { Request, Response } from "express"
import { z } from "zod"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { getSettings, updatePassword } from "./settings_service"

const passwordSchema = z.object({
    current_password: z.string().min(1, "Current password is required"),
    new_password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[0-9]/, "Password must contain at least one number"),
})

export async function getSettingsController(req: Request, res: Response): Promise<void> {
    try {
        const {
            user: { id: userId },
        } = req as AuthenticatedRequest

        res.status(200).json(await getSettings(userId))
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get settings"
        res.status(message === "User not found" ? 404 : 500).json({ error: message })
    }
}

export async function updatePasswordController(req: Request, res: Response): Promise<void> {
    const parsed = passwordSchema.safeParse(req.body)
    if (!parsed.success) {
        res.status(400).json({
            error: "Invalid password payload",
            errors: parsed.error.flatten().fieldErrors,
        })
        return
    }

    try {
        const {
            user: { id: userId },
        } = req as AuthenticatedRequest

        const result = await updatePassword(
            userId,
            parsed.data.current_password,
            parsed.data.new_password,
        )

        res.status(200).json(result)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update password"
        const statusCode =
            message === "User not found" ? 404 :
            message === "Current password is incorrect" ? 400 :
            message === "New password must be different from current password" ? 400 :
            500

        res.status(statusCode).json({ error: message })
    }
}
