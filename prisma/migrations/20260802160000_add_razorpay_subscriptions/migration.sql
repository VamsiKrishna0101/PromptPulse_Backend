ALTER TABLE "Subscription"
ADD COLUMN "razorpay_subscription_id" TEXT,
ADD COLUMN "razorpay_plan_id" TEXT,
ADD COLUMN "razorpay_paid_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "next_credit_grant_at" TIMESTAMP(3);

ALTER TABLE "CreditTransaction" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "CreditTransaction_idempotency_key_key" ON "CreditTransaction"("idempotency_key");

CREATE UNIQUE INDEX "Subscription_razorpay_subscription_id_key"
ON "Subscription"("razorpay_subscription_id");

CREATE TABLE "RazorpayWebhookEvent" (
  "id" TEXT NOT NULL,
  "webhook_key" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "error_reason" TEXT,
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RazorpayWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RazorpayWebhookEvent_webhook_key_key" ON "RazorpayWebhookEvent"("webhook_key");
CREATE INDEX "RazorpayWebhookEvent_status_created_at_idx" ON "RazorpayWebhookEvent"("status", "created_at");

CREATE TABLE "SubscriptionCreditGrant" (
  "id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "grant_key" TEXT NOT NULL,
  "credits" INTEGER NOT NULL,
  "scheduled_for" TIMESTAMP(3) NOT NULL,
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionCreditGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionCreditGrant_grant_key_key" ON "SubscriptionCreditGrant"("grant_key");
CREATE INDEX "SubscriptionCreditGrant_subscription_id_scheduled_for_idx" ON "SubscriptionCreditGrant"("subscription_id", "scheduled_for");
ALTER TABLE "SubscriptionCreditGrant" ADD CONSTRAINT "SubscriptionCreditGrant_subscription_id_fkey"
FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
