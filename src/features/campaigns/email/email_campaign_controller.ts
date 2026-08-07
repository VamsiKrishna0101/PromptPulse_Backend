import { Request, Response } from "express"
import * as emailService from "./email_campaign_service"
import prisma from "../../../lib/prisma"

export async function createAccount(req: Request, res: Response) {
    try {
        const userId = req.user?.id
        const projectId = req.headers["x-project-id"] as string

        if (!userId || !projectId) {
            return res.status(400).json({ error: "Missing user or project ID" })
        }

        const { fromName, fromEmail, provider, awsRegion, awsAccessKey, awsSecretKey } = req.body

        // Check if account already exists
        const existing = await prisma.emailAccount.findUnique({
            where: { project_id: projectId }
        })

        if (existing) {
            const updated = await prisma.emailAccount.update({
                where: { project_id: projectId },
                data: {
                    from_name: fromName,
                    from_email: fromEmail,
                    provider: provider || "AWS_SES",
                    aws_region: awsRegion,
                    aws_access_key: awsAccessKey,
                    aws_secret_key: awsSecretKey,
                    is_verified: true // Assume verified for now, or add SES verification logic later
                }
            })
            return res.json(updated)
        }

        const account = await prisma.emailAccount.create({
            data: {
                project_id: projectId,
                user_id: userId,
                from_name: fromName,
                from_email: fromEmail,
                provider: provider || "AWS_SES",
                aws_region: awsRegion,
                aws_access_key: awsAccessKey,
                aws_secret_key: awsSecretKey,
                is_verified: true
            }
        })

        res.json(account)
    } catch (error: any) {
        console.error("Create Email Account Error:", error)
        res.status(500).json({ error: error.message })
    }
}

export async function getAccount(req: Request, res: Response) {
    try {
        const projectId = req.headers["x-project-id"] as string
        if (!projectId) {
            return res.status(400).json({ error: "Missing project ID" })
        }

        const account = await prisma.emailAccount.findUnique({
            where: { project_id: projectId }
        })

        res.json(account)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
}

export async function createCampaign(req: Request, res: Response) {
    try {
        const userId = req.user?.id
        const projectId = req.headers["x-project-id"] as string

        if (!userId || !projectId) {
            return res.status(400).json({ error: "Missing user or project ID" })
        }

        const account = await prisma.emailAccount.findUnique({ where: { project_id: projectId } })
        if (!account) return res.status(404).json({ error: "Email account not found" })

        const campaign = await emailService.createEmailCampaign(projectId, userId, {
            name: req.body.name,
            templateId: req.body.templateId,
            accountId: account.id
        })

        res.json(campaign)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
}

export async function listCampaigns(req: Request, res: Response) {
    try {
        const projectId = req.headers["x-project-id"] as string
        const account = await prisma.emailAccount.findUnique({ where: { project_id: projectId } })
        if (!account) return res.json([])

        const campaigns = await emailService.listEmailCampaigns(account.id)
        res.json(campaigns)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
}

export async function getCampaign(req: Request, res: Response) {
    try {
        const projectId = req.headers["x-project-id"] as string
        const campaign = await emailService.getEmailCampaign(req.params.id, projectId)
        res.json(campaign)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
}

export async function uploadRecipients(req: Request, res: Response) {
    try {
        const projectId = req.headers["x-project-id"] as string
        const { csv } = req.body

        // Verify ownership
        await emailService.getEmailCampaign(req.params.id, projectId)

        const count = await emailService.addRecipientsFromCsv(req.params.id, csv)
        res.json({ success: true, count })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
}

export async function launchCampaign(req: Request, res: Response) {
    try {
        const projectId = req.headers["x-project-id"] as string
        await emailService.launchEmailCampaign(req.params.id, projectId)
        res.json({ success: true })
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
}

export async function createTemplate(req: Request, res: Response) {
    try {
        const projectId = req.headers["x-project-id"] as string
        const account = await prisma.emailAccount.findUnique({ where: { project_id: projectId } })
        if (!account) return res.status(404).json({ error: "Email account not found" })

        const template = await emailService.createEmailTemplate(account.id, {
            name: req.body.name,
            subject: req.body.subject,
            htmlBody: req.body.htmlBody,
            designJson: req.body.designJson
        })

        res.json(template)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
}

export async function listTemplates(req: Request, res: Response) {
    try {
        const projectId = req.headers["x-project-id"] as string
        const account = await prisma.emailAccount.findUnique({ where: { project_id: projectId } })
        if (!account) return res.json([])

        const templates = await emailService.listEmailTemplates(account.id)
        res.json(templates)
    } catch (error: any) {
        res.status(500).json({ error: error.message })
    }
}
