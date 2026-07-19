import type Stripe from "stripe"
import prisma from "../../lib/prisma"
import { sendPaidInvoiceEmail, sendPaymentFailedEmail } from "./billing_email_service"
import { getStripeId } from "./stripe_config"
import type { PaidPlan } from "./subscription_types"

export function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    const value = invoice as Stripe.Invoice & {
        subscription?: string | { id: string } | null
        parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null
    }
    return getStripeId(value.subscription ?? value.parent?.subscription_details?.subscription)
}

function asDate(value?: number | null) {
    return value ? new Date(value * 1000) : null
}

export async function persistStripeInvoice(invoice: Stripe.Invoice) {
    const stripeSubscriptionId = getInvoiceSubscriptionId(invoice)
    const localSubscription = stripeSubscriptionId
        ? await prisma.subscription.findUnique({
            where: { stripe_subscription_id: stripeSubscriptionId },
            select: { id: true, user_id: true, plan: true, billing_interval: true },
        })
        : null

    if (!localSubscription) throw new Error(`No PromptPulse subscription found for Stripe invoice ${invoice.id}`)

    const record = await prisma.billingInvoice.upsert({
        where: { stripe_invoice_id: invoice.id },
        create: {
            user_id: localSubscription.user_id,
            subscription_id: localSubscription.id,
            stripe_invoice_id: invoice.id,
            stripe_subscription_id: stripeSubscriptionId,
            invoice_number: invoice.number,
            status: invoice.status ?? "unknown",
            billing_reason: invoice.billing_reason,
            currency: invoice.currency,
            amount_due: invoice.amount_due,
            amount_paid: invoice.amount_paid,
            amount_remaining: invoice.amount_remaining,
            period_start: asDate(invoice.period_start),
            period_end: asDate(invoice.period_end),
            hosted_invoice_url: invoice.hosted_invoice_url,
            invoice_pdf_url: invoice.invoice_pdf,
            paid_at: invoice.status_transitions?.paid_at ? asDate(invoice.status_transitions.paid_at) : null,
        },
        update: {
            subscription_id: localSubscription.id,
            status: invoice.status ?? "unknown",
            invoice_number: invoice.number,
            amount_due: invoice.amount_due,
            amount_paid: invoice.amount_paid,
            amount_remaining: invoice.amount_remaining,
            hosted_invoice_url: invoice.hosted_invoice_url,
            invoice_pdf_url: invoice.invoice_pdf,
            paid_at: invoice.status_transitions?.paid_at ? asDate(invoice.status_transitions.paid_at) : null,
        },
    })

    return { record, subscription: localSubscription }
}

export async function processPaidInvoice(invoice: Stripe.Invoice) {
    const { record, subscription } = await persistStripeInvoice(invoice)
    if (record.payment_email_sent_at || invoice.amount_paid <= 0) return record

    const user = await prisma.user.findUniqueOrThrow({ where: { id: subscription.user_id }, select: { email: true } })
    try {
        const response = await sendPaidInvoiceEmail({
            to: user.email,
            plan: subscription.plan as PaidPlan,
            interval: subscription.billing_interval,
            amountPaid: invoice.amount_paid,
            currency: invoice.currency,
            invoiceNumber: invoice.number,
            invoicePdfUrl: invoice.invoice_pdf ?? null,
            hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
            isFirstPayment: invoice.billing_reason === "subscription_create",
        })
        return prisma.billingInvoice.update({
            where: { id: record.id },
            data: { payment_email_sent_at: new Date(), payment_email_message_id: response.messageId ?? null, email_error: null },
        })
    } catch (error) {
        await prisma.billingInvoice.update({ where: { id: record.id }, data: { email_error: error instanceof Error ? error.message : String(error) } })
        throw error
    }
}

export async function processFailedInvoice(invoice: Stripe.Invoice) {
    const { record, subscription } = await persistStripeInvoice(invoice)
    if (record.failure_email_sent_at) return record

    const user = await prisma.user.findUniqueOrThrow({ where: { id: subscription.user_id }, select: { email: true } })
    try {
        const response = await sendPaymentFailedEmail({ to: user.email, plan: subscription.plan as PaidPlan, hostedInvoiceUrl: invoice.hosted_invoice_url ?? null })
        return prisma.billingInvoice.update({
            where: { id: record.id },
            data: { failure_email_sent_at: new Date(), failure_email_message_id: response.messageId ?? null, email_error: null },
        })
    } catch (error) {
        await prisma.billingInvoice.update({ where: { id: record.id }, data: { email_error: error instanceof Error ? error.message : String(error) } })
        throw error
    }
}

export async function listBillingInvoices(userId: string) {
    return prisma.billingInvoice.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        take: 24,
        select: { id: true, invoice_number: true, status: true, currency: true, amount_paid: true, created_at: true, hosted_invoice_url: true, invoice_pdf_url: true },
    })
}
