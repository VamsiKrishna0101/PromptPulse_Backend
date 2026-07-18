import { Request, Response } from "express"
import type { AuthenticatedRequest } from "../../middleware/auth"
import { getChatArtifactSignedUrl } from "./artifact_service"

export async function getChatArtifactUrlController(req: Request, res: Response): Promise<void> {
    try {
        const { chat_id } = req.params
        if (!chat_id || Array.isArray(chat_id)) {
            res.status(400).json({ error: "chat_id is required" })
            return
        }

        const user_id = (req as AuthenticatedRequest).user.id
        const result = await getChatArtifactSignedUrl({ chat_id, user_id })
        res.status(200).json(result)
    } catch (error) {
        if (error instanceof Error) {
            if (error.message === "CHAT_NOT_FOUND") {
                res.status(404).json({ error: "Chat not found" })
                return
            }
            if (error.message === "ARTIFACT_NOT_FOUND") {
                res.status(404).json({ error: "No screenshot is available for this chat" })
                return
            }
            if (error.message === "ARTIFACT_EXPIRED") {
                res.status(410).json({ error: "This screenshot has expired" })
                return
            }
            if (error.message === "ARTIFACT_NOT_CLOUD_BACKED") {
                res.status(422).json({ error: "This screenshot is not stored in cloud storage yet" })
                return
            }
        }

        console.error("Failed to create artifact signed URL", error)
        res.status(500).json({ error: "Failed to open screenshot" })
    }
}
