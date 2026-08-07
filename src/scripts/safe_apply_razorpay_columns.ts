import "dotenv/config"
import { Client } from "pg"

async function run() {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error("DATABASE_URL is required")

    const client = new Client({
        connectionString,
        ssl: connectionString.includes("supabase.co")
            ? { rejectUnauthorized: false }
            : undefined
    })

    await client.connect()
    try {
        console.log("Applying safe, non-destructive schema additions with IF NOT EXISTS...")
        
        await client.query(`
            ALTER TABLE "Subscription"
            ADD COLUMN IF NOT EXISTS "razorpay_subscription_id" TEXT,
            ADD COLUMN IF NOT EXISTS "razorpay_plan_id" TEXT,
            ADD COLUMN IF NOT EXISTS "razorpay_paid_count" INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS "next_credit_grant_at" TIMESTAMP(3);

            ALTER TABLE "CreditTransaction" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
            CREATE UNIQUE INDEX IF NOT EXISTS "CreditTransaction_idempotency_key_key" ON "CreditTransaction"("idempotency_key");

            CREATE UNIQUE INDEX IF NOT EXISTS "Subscription_razorpay_subscription_id_key"
            ON "Subscription"("razorpay_subscription_id");

            CREATE TABLE IF NOT EXISTS "RazorpayWebhookEvent" (
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

            CREATE UNIQUE INDEX IF NOT EXISTS "RazorpayWebhookEvent_webhook_key_key" ON "RazorpayWebhookEvent"("webhook_key");
            CREATE INDEX IF NOT EXISTS "RazorpayWebhookEvent_status_created_at_idx" ON "RazorpayWebhookEvent"("status", "created_at");

            CREATE TABLE IF NOT EXISTS "SubscriptionCreditGrant" (
              "id" TEXT NOT NULL,
              "subscription_id" TEXT NOT NULL,
              "grant_key" TEXT NOT NULL,
              "credits" INTEGER NOT NULL,
              "scheduled_for" TIMESTAMP(3) NOT NULL,
              "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT "SubscriptionCreditGrant_pkey" PRIMARY KEY ("id")
            );

            CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionCreditGrant_grant_key_key" ON "SubscriptionCreditGrant"("grant_key");
            CREATE INDEX IF NOT EXISTS "SubscriptionCreditGrant_subscription_id_scheduled_for_idx" ON "SubscriptionCreditGrant"("subscription_id", "scheduled_for");
        `)

        await client.query(`
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionCreditGrant_subscription_id_fkey'
              ) THEN
                ALTER TABLE "SubscriptionCreditGrant" ADD CONSTRAINT "SubscriptionCreditGrant_subscription_id_fkey"
                FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
              END IF;
            END $$;
        `)

        console.log("Safe additions applied successfully without modifying or dropping any existing data.")
    } finally {
        await client.end()
    }
}

run().catch(err => {
    console.error("Migration error:", err)
    process.exit(1)
})
