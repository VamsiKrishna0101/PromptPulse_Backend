import type Stripe from "stripe"
import prisma from "../../lib/prisma"
import { processFailedInvoice, processPaidInvoice, getInvoiceSubscriptionId } from "./billing_invoice_service"
import { getStripeClient, getStripeId } from "./stripe_config"
import { syncSubscriptionFromStripe } from "./subscription_service"

async function beginEvent(event: Stripe.Event) {
    const existing = await prisma.stripeWebhookEvent.findUnique({ where: { stripe_event_id: event.id } })
    if (existing?.status === "COMPLETE") return false
    if (existing?.status === "PROCESSING" && Date.now() - existing.updated_at.getTime() < 5 * 60 * 1000) return false
    if (existing) {
        await prisma.stripeWebhookEvent.update({ where: { id: existing.id }, data: { status: "PROCESSING", error_reason: null } })
        return true
    }
    try {
        await prisma.stripeWebhookEvent.create({ data: { stripe_event_id: event.id, event_type: event.type } })
        return true
    } catch {
        return false
    }
}

async function syncInvoiceSubscription(invoice: Stripe.Invoice) {
    const subscriptionId = getInvoiceSubscriptionId(invoice)
    if (!subscriptionId) return
    const subscription = await getStripeClient().subscriptions.retrieve(subscriptionId)
    await syncSubscriptionFromStripe(subscription)
}

async function processEvent(event: Stripe.Event) {
    const stripe = getStripeClient()
    if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session
        const subscriptionId = getStripeId(session.subscription)
        if (subscriptionId) await syncSubscriptionFromStripe(await stripe.subscriptions.retrieve(subscriptionId))
        return
    }
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
        await syncSubscriptionFromStripe(event.data.object as Stripe.Subscription)
        return
    }
    if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
        const invoice = event.data.object as Stripe.Invoice
        await syncInvoiceSubscription(invoice)
        await processPaidInvoice(invoice)
        return
    }
    if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required") {
        const invoice = event.data.object as Stripe.Invoice
        await syncInvoiceSubscription(invoice)
        await processFailedInvoice(invoice)
    }
}

export async function handleStripeWebhook(rawBody: Buffer | string, signature: string | undefined) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is required")
    if (!signature) throw new Error("Missing Stripe signature")

    const event = getStripeClient().webhooks.constructEvent(rawBody, signature, secret)
    if (!(await beginEvent(event))) return { received: true, duplicate: true, event_type: event.type }

    try {
        await processEvent(event)
        await prisma.stripeWebhookEvent.update({ where: { stripe_event_id: event.id }, data: { status: "COMPLETE", processed_at: new Date(), error_reason: null } })
        return { received: true, duplicate: false, event_type: event.type }
    } catch (error) {
        await prisma.stripeWebhookEvent.update({ where: { stripe_event_id: event.id }, data: { status: "FAILED", error_reason: error instanceof Error ? error.message : String(error) } })
        throw error
    }
}
