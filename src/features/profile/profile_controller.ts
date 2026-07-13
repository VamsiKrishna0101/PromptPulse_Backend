import type { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { getProfileData } from "./profile_service"

export async function getProfileController(req: Request, res: Response): Promise<void> {
    try {
        const {
            user: { id: userId },
        } = req as AuthenticatedRequest

        const profile = await getProfileData(userId)
        res.status(200).json(profile)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to get profile"
        const statusCode = message === "User not found" ? 404 : 500
        res.status(statusCode).json({ error: message })
    }
}
