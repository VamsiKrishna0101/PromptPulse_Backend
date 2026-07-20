import type { Request, Response } from "express"
import { answerLandingChat, createLandingLead } from "./landing_chat_service"

export async function answerLandingChatController(req: Request, res: Response) {
    try {
        const message = typeof req.body?.message === "string" ? req.body.message : ""
        const page_path = typeof req.body?.page_path === "string" ? req.body.page_path : undefined

        if (!message.trim()) {
            res.status(400).json({ error: "Message is required" })
            return
        }

        res.status(200).json(await answerLandingChat({ message, page_path }))
    } catch (error) {
        console.error("Landing chat answer failed", error)
        res.status(500).json({ error: "Failed to answer question" })
    }
}

export async function createLandingLeadController(req: Request, res: Response) {
    try {
        const message = typeof req.body?.message === "string" ? req.body.message : ""
        if (!message.trim()) {
            res.status(400).json({ error: "Message is required" })
            return
        }

        const userAgentHeader = req.headers["user-agent"]
        const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader.join(" ") : userAgentHeader

        const lead = await createLandingLead(
            {
                message,
                email: typeof req.body?.email === "string" ? req.body.email : undefined,
                name: typeof req.body?.name === "string" ? req.body.name : undefined,
                company: typeof req.body?.company === "string" ? req.body.company : undefined,
                page_path: typeof req.body?.page_path === "string" ? req.body.page_path : undefined,
            },
            {
                ip: req.ip,
                user_agent: userAgent,
            }
        )

        res.status(201).json({
            ok: true,
            lead_id: lead.id,
            message: "Thanks. We received your message and will reply by email if you shared one.",
        })
    } catch (error) {
        console.error("Landing chat lead failed", error)
        res.status(500).json({ error: "Failed to send message" })
    }
}
