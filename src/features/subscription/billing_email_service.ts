import axios from "axios"
import { sendEmail } from "../email/email_service"
import type { PaidPlan } from "./subscription_types"

type InvoiceEmailInput = {
    to: string
    plan: PaidPlan
    interval: string
    amountPaid: number
    currency: string
    invoiceNumber: string | null
    invoicePdfUrl: string | null
    hostedInvoiceUrl: string | null
    isFirstPayment: boolean
}

function money(amount: number, currency: string) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100)
}

async function invoiceAttachment(url: string | null, invoiceNumber: string | null) {
    if (!url) return undefined
    try {
        const response = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", timeout: 15000 })
        return [{ name: `${invoiceNumber ?? "promptpulse-invoice"}.pdf`, content: Buffer.from(response.data) }]
    } catch (error) {
        console.warn("Stripe invoice PDF attachment download failed; sending hosted link instead", error)
        return undefined
    }
}

export async function sendPaidInvoiceEmail(input: InvoiceEmailInput) {
    const title = input.isFirstPayment ? `Welcome to PromptPulse ${input.plan}` : "Your PromptPulse payment was received"
    const attachment = await invoiceAttachment(input.invoicePdfUrl, input.invoiceNumber)
    return sendEmail({
        to: input.to,
        subject: input.isFirstPayment ? `Welcome to PromptPulse ${input.plan} - payment confirmed` : "PromptPulse payment receipt",
        text: `${title}. We received ${money(input.amountPaid, input.currency)}. ${input.hostedInvoiceUrl ?? ""}`,
        attachments: attachment,
        html: `
          <div style="background:#f5f7fb;padding:32px 16px;font-family:Arial,sans-serif;color:#101828">
            <div style="max-width:600px;margin:auto;background:#fff;border:1px solid #e4e7ec;border-radius:18px;overflow:hidden">
              <div style="background:#0b1220;padding:26px 30px;color:#fff"><div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#86efac">PromptPulse</div><h1 style="margin:10px 0 0;font-size:26px">${title}</h1></div>
              <div style="padding:28px 30px"><p style="margin:0 0 20px;color:#475467;line-height:1.6">Thank you for choosing PromptPulse. Your ${input.plan.toLowerCase()} plan is active and ready for your AI visibility workflow.</p>
                <div style="background:#f8fafc;border:1px solid #eaecf0;border-radius:12px;padding:18px"><div style="font-size:12px;color:#667085">Amount paid</div><div style="font-size:24px;font-weight:700;margin-top:4px">${money(input.amountPaid, input.currency)}</div><div style="font-size:13px;color:#667085;margin-top:8px">${input.interval === "annual" ? "Annual billing" : "Monthly billing"}${input.invoiceNumber ? ` · Invoice ${input.invoiceNumber}` : ""}</div></div>
                ${input.hostedInvoiceUrl ? `<p style="margin:22px 0 0"><a href="${input.hostedInvoiceUrl}" style="display:inline-block;background:#101828;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:700">View invoice</a></p>` : ""}
                <p style="margin:22px 0 0;color:#667085;font-size:13px;line-height:1.5">${attachment ? "A PDF copy of your Stripe invoice is attached." : "Use the invoice link above to view or download your Stripe invoice."}</p>
              </div>
            </div>
          </div>`,
    })
}

export async function sendPaymentFailedEmail(input: { to: string; plan: PaidPlan; hostedInvoiceUrl: string | null }) {
    return sendEmail({
        to: input.to,
        subject: "Action needed: PromptPulse payment failed",
        text: "We could not process your PromptPulse payment. Please update your payment method.",
        html: `<div style="background:#f8fafc;padding:28px;font-family:Arial,sans-serif"><div style="max-width:560px;margin:auto;background:white;border:1px solid #fecaca;border-radius:16px;padding:28px"><h1 style="margin:0;color:#991b1b">Payment needs attention</h1><p style="color:#475569;line-height:1.6">We could not process the latest payment for your ${input.plan} plan. Your data remains safe. Please update your payment method to keep scheduled monitoring active.</p>${input.hostedInvoiceUrl ? `<a href="${input.hostedInvoiceUrl}" style="display:inline-block;background:#101828;color:white;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:700">Review payment</a>` : ""}</div></div>`,
    })
}
