import { EmailCampaignStatus, EmailRecipientStatus } from "@prisma/client"
import prisma from "../../../lib/prisma"
import { sendEmail } from "../../email/email_service"

export async function createEmailCampaign(
    projectId: string,
    userId: string,
    data: {
        name: string
        templateId?: string
        accountId: string
    }
) {
    return await prisma.emailCampaign.create({
        data: {
            name: data.name,
            account_id: data.accountId,
            user_id: userId,
            template_id: data.templateId,
            status: "DRAFT"
        }
    })
}

export async function getEmailCampaign(campaignId: string, projectId: string) {
    const campaign = await prisma.emailCampaign.findUnique({
        where: { id: campaignId },
        include: {
            template: true,
            account: true,
            _count: { select: { recipients: true } }
        }
    })
    
    if (!campaign || campaign.account.project_id !== projectId) {
        throw new Error("Campaign not found")
    }

    return campaign
}

export async function listEmailCampaigns(accountId: string) {
    return await prisma.emailCampaign.findMany({
        where: { account_id: accountId },
        include: {
            template: true,
            _count: { select: { recipients: true } }
        },
        orderBy: { created_at: "desc" }
    })
}

export async function createEmailTemplate(
    accountId: string,
    data: {
        name: string
        subject: string
        htmlBody: string
        designJson?: any
    }
) {
    return await prisma.emailTemplate.create({
        data: {
            account_id: accountId,
            name: data.name,
            subject: data.subject,
            html_body: data.htmlBody,
            design_json: data.designJson
        }
    })
}

export async function listEmailTemplates(accountId: string) {
    return await prisma.emailTemplate.findMany({
        where: { account_id: accountId },
        orderBy: { updated_at: "desc" }
    })
}

export async function addRecipientsFromCsv(campaignId: string, csvText: string) {
    // Simple CSV parser for "Name,Email" format
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0)
    
    // Check if first line is header
    let startIndex = 0
    const firstLine = lines[0].toLowerCase()
    if (firstLine.includes("email") || firstLine.includes("name")) {
        startIndex = 1
    }

    const recipients = []
    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i]
        // Split by comma, respecting quotes is hard with simple split, but we do basic splitting
        const parts = line.split(",").map(p => p.trim())
        
        let name = ""
        let email = ""
        
        // Try to guess which is email
        if (parts.length >= 2) {
            if (parts[1].includes("@")) {
                name = parts[0]
                email = parts[1]
            } else if (parts[0].includes("@")) {
                email = parts[0]
                name = parts[1]
            }
        } else if (parts.length === 1 && parts[0].includes("@")) {
            email = parts[0]
        }

        if (email) {
            recipients.push({
                campaign_id: campaignId,
                email,
                name: name || null,
                status: "QUEUED" as EmailRecipientStatus,
                variables: name ? { name } : {}
            })
        }
    }

    if (recipients.length > 0) {
        await prisma.emailCampaignRecipient.createMany({
            data: recipients,
            skipDuplicates: true
        })

        await prisma.emailCampaign.update({
            where: { id: campaignId },
            data: {
                total_recipients: { increment: recipients.length }
            }
        })
    }

    return recipients.length
}

export async function launchEmailCampaign(campaignId: string, projectId: string) {
    const campaign = await getEmailCampaign(campaignId, projectId)
    
    if (!campaign.template) {
        throw new Error("Cannot launch campaign without a template")
    }

    if (campaign.status !== "DRAFT") {
        throw new Error("Campaign is already running or completed")
    }

    await prisma.emailCampaign.update({
        where: { id: campaignId },
        data: {
            status: "RUNNING",
            started_at: new Date()
        }
    })

    // Fire and forget processor
    processCampaign(campaignId).catch(err => {
        console.error(`Error processing campaign ${campaignId}:`, err)
    })

    return true
}

async function processCampaign(campaignId: string) {
    const campaign = await prisma.emailCampaign.findUnique({
        where: { id: campaignId },
        include: { template: true, account: true }
    })

    if (!campaign || !campaign.template) return

    const recipients = await prisma.emailCampaignRecipient.findMany({
        where: { campaign_id: campaignId, status: "QUEUED" }
    })

    let sent = 0
    let failed = 0

    const { aws_region, aws_access_key, aws_secret_key, from_email, from_name } = campaign.account
    const awsConfig = (aws_region && aws_access_key && aws_secret_key) ? {
        region: aws_region,
        accessKey: aws_access_key,
        secretKey: aws_secret_key,
        source: `${from_name} <${from_email}>`
    } : undefined

    for (const recipient of recipients) {
        try {
            // Replace variables in HTML
            let personalizedHtml = campaign.template.html_body
            if (recipient.name) {
                personalizedHtml = personalizedHtml.replace(/\{\{\s*name\s*\}\}/g, recipient.name)
            }
            
            // Replace other variables if any
            if (recipient.variables && typeof recipient.variables === "object") {
                for (const [key, value] of Object.entries(recipient.variables as any)) {
                    const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "g")
                    personalizedHtml = personalizedHtml.replace(regex, String(value))
                }
            }

            const response = await sendEmail({
                to: recipient.email,
                subject: campaign.template.subject,
                html: personalizedHtml,
                awsConfig
            })

            await prisma.emailCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: "SENT",
                    sent_at: new Date(),
                    message_id: response.messageId
                }
            })
            sent++
        } catch (error: any) {
            await prisma.emailCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: "FAILED",
                    error_msg: error.message || "Unknown error"
                }
            })
            failed++
        }

        // Slight delay to respect SES limits (e.g. 14 sends per second limit)
        // 100ms = 10 sends per second max
        await new Promise(resolve => setTimeout(resolve, 100))
    }

    await prisma.emailCampaign.update({
        where: { id: campaignId },
        data: {
            status: "COMPLETED",
            completed_at: new Date(),
            sent_count: { increment: sent },
            failed_count: { increment: failed }
        }
    })
}
