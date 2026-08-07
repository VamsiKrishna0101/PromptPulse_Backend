import axios from "axios"
import https from "https"
import { SESClient, SendEmailCommand, SendRawEmailCommand } from "@aws-sdk/client-ses"

type SendEmailInput = {
    to: string
    subject: string
    html: string
    text?: string
    attachments?: Array<{
        name: string
        content: Buffer
    }>
}

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email"

function getBrevoHttpsAgent() {
    return new https.Agent({
        rejectUnauthorized: process.env.BREVO_TLS_REJECT_UNAUTHORIZED === "true",
    })
}

type BrevoSendResponse = {
    messageId?: string
}

export async function sendEmail(input: SendEmailInput & { awsConfig?: { region: string, accessKey: string, secretKey: string, source: string } }) {
    const provider = process.env.EMAIL_PROVIDER ?? "brevo"
    if (provider !== "brevo" && provider !== "ses") {
        throw new Error(`Unsupported email provider: ${provider}`)
    }

    if (provider === "ses") {
        const region = input.awsConfig?.region || process.env.AWS_SES_REGION || "ap-south-1"
        const accessKeyId = input.awsConfig?.accessKey || process.env.AWS_ACCESS_KEY_ID
        const secretAccessKey = input.awsConfig?.secretKey || process.env.AWS_SECRET_ACCESS_KEY
        
        if (!accessKeyId || !secretAccessKey) {
            throw new Error("AWS SES credentials not configured")
        }

        const sesClient = new SESClient({
            region,
            credentials: {
                accessKeyId,
                secretAccessKey,
            }
        })

        const source = input.awsConfig?.source || `${process.env.EMAIL_FROM_NAME ?? "PromptPulse"} <${process.env.EMAIL_FROM_ADDRESS ?? "noreply@promptpulse.online"}>`

        const command = new SendEmailCommand({
            Source: source,
            Destination: {
                ToAddresses: [input.to]
            },
            Message: {
                Subject: { Data: input.subject, Charset: "UTF-8" },
                Body: {
                    Html: { Data: input.html, Charset: "UTF-8" },
                    ...(input.text ? { Text: { Data: input.text, Charset: "UTF-8" } } : {})
                }
            }
        })

        try {
            const response = await sesClient.send(command)
            return { messageId: response.MessageId }
        } catch (error) {
            console.error("AWS SES email send failed", error)
            throw error
        }
    }

    const apiKey = process.env.BREVO_API_KEY
    if (!apiKey) {
        throw new Error("BREVO_API_KEY is not configured")
    }

    const fromEmail = process.env.EMAIL_FROM_ADDRESS ?? "noreply@promptpulse.online"
    const fromName = process.env.EMAIL_FROM_NAME ?? "PromptPulse"

    try {
        const response = await axios.post<BrevoSendResponse>(
            BREVO_API_URL,
            {
                sender: {
                    name: fromName,
                    email: fromEmail,
                },
                to: [{ email: input.to }],
                subject: input.subject,
                htmlContent: input.html,
                textContent: input.text,
                attachment: input.attachments?.map(attachment => ({
                    name: attachment.name,
                    content: attachment.content.toString("base64"),
                })),
            },
            {
                httpsAgent: getBrevoHttpsAgent(),
                headers: {
                    "api-key": apiKey,
                    "Content-Type": "application/json",
                },
                timeout: 15000,
            },
        )
        return response.data
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status
            const data = error.response?.data as { code?: string; message?: string } | undefined
            const brevoMessage = data?.message ?? error.message
            console.error("Brevo email send failed", {
                status,
                code: data?.code,
                message: brevoMessage,
                fromEmail,
                to: input.to,
            })
            throw new Error(`Brevo email send failed${status ? ` (${status})` : ""}: ${brevoMessage}`)
        }
        throw error
    }
}

export async function sendVerificationOtpEmail(email: string, otp: string) {
    await sendEmail({
        to: email,
        subject: "Verify your PromptPulse email",
        text: `Your PromptPulse verification code is ${otp}. It expires in 10 minutes.`,
        html: `
            <div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:28px;color:#0f172a">
                <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;padding:28px">
                    <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb">PromptPulse</p>
                    <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">Verify your email</h1>
                    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#475569">Use this code to finish creating your PromptPulse workspace.</p>
                    <div style="font-size:32px;font-weight:800;letter-spacing:.18em;background:#f1f5f9;border:1px solid #dbe4ef;border-radius:14px;padding:18px 20px;text-align:center">${otp}</div>
                    <p style="margin:20px 0 0;font-size:13px;color:#64748b">This code expires in 10 minutes. If you did not request it, you can safely ignore this email.</p>
                </div>
            </div>
        `,
    })
}

export async function sendAgencyInvitationEmail(email: string, agencyEmail: string, inviteUrl: string) {
    await sendEmail({
        to: email,
        subject: `${agencyEmail} invited you to PromptPulse`,
        text: `${agencyEmail} invited you to collaborate in PromptPulse. Accept your invitation here: ${inviteUrl}`,
        html: `<div style="font-family:Inter,Arial,sans-serif;background:#f8fafc;padding:28px;color:#0f172a"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:28px"><p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2563eb">PromptPulse</p><h1 style="margin:0 0 12px;font-size:24px">You have a new workspace invitation</h1><p style="color:#475569;line-height:1.6">${agencyEmail} invited you to collaborate with their agency in PromptPulse.</p><a href="${inviteUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:13px 18px;border-radius:10px;text-decoration:none;font-weight:700">Accept invitation</a><p style="font-size:13px;color:#64748b;line-height:1.6">This invitation expires in 7 days.</p></div></div>`,
    })
}
