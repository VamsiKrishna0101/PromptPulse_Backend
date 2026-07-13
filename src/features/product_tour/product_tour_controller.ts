import type { Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { completeProductTour, getProductTourStatus } from "./product_tour_service"

export async function getProductTourStatusController(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const status = await getProductTourStatus(req.user.id)
        res.status(200).json(status)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load product tour status"
        res.status(message === "User not found" ? 404 : 500).json({ error: message })
    }
}

export async function completeProductTourController(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
        const status = await completeProductTour(req.user.id)
        res.status(200).json(status)
    } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update product tour status"
        res.status(500).json({ error: message })
    }
}

