ALTER TABLE "Subscription"
ADD COLUMN "stripe_checkout_session_id" TEXT,
ADD COLUMN "billing_interval" TEXT NOT NULL DEFAULT 'monthly';

CREATE UNIQUE INDEX "Subscription_stripe_checkout_session_id_key"
ON "Subscription"("stripe_checkout_session_id");

CREATE TABLE "StripeWebhookEvent" (
  "id" TEXT NOT NULL,
  "stripe_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "error_reason" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StripeWebhookEvent_stripe_event_id_key" ON "StripeWebhookEvent"("stripe_event_id");
CREATE INDEX "StripeWebhookEvent_status_created_at_idx" ON "StripeWebhookEvent"("status", "created_at");

CREATE TABLE "BillingInvoice" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "subscription_id" TEXT,
  "stripe_invoice_id" TEXT NOT NULL,
  "stripe_subscription_id" TEXT,
  "invoice_number" TEXT,
  "status" TEXT NOT NULL,
  "billing_reason" TEXT,
  "currency" TEXT NOT NULL,
  "amount_due" INTEGER NOT NULL,
  "amount_paid" INTEGER NOT NULL,
  "amount_remaining" INTEGER NOT NULL,
  "period_start" TIMESTAMP(3),
  "period_end" TIMESTAMP(3),
  "hosted_invoice_url" TEXT,
  "invoice_pdf_url" TEXT,
  "payment_email_sent_at" TIMESTAMP(3),
  "payment_email_message_id" TEXT,
  "failure_email_sent_at" TIMESTAMP(3),
  "failure_email_message_id" TEXT,
  "email_error" TEXT,
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingInvoice_stripe_invoice_id_key" ON "BillingInvoice"("stripe_invoice_id");
CREATE INDEX "BillingInvoice_user_id_created_at_idx" ON "BillingInvoice"("user_id", "created_at");
CREATE INDEX "BillingInvoice_stripe_subscription_id_idx" ON "BillingInvoice"("stripe_subscription_id");
CREATE INDEX "BillingInvoice_status_created_at_idx" ON "BillingInvoice"("status", "created_at");
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
