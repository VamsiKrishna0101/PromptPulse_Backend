ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "credits_balance" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "CreditTransaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "amount" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "description" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CreditTransaction_user_id_created_at_idx"
  ON "CreditTransaction"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "CreditTransaction_user_id_action_idx"
  ON "CreditTransaction"("user_id", "action");

CREATE TABLE IF NOT EXISTS "RazorpayOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "razorpay_order_id" TEXT NOT NULL UNIQUE,
  "razorpay_payment_id" TEXT UNIQUE,
  "amount_inr_paise" INTEGER NOT NULL,
  "credits_to_award" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "idempotency_key" TEXT UNIQUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "RazorpayOrder_user_id_created_at_idx"
  ON "RazorpayOrder"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "RazorpayOrder_status_created_at_idx"
  ON "RazorpayOrder"("status", "created_at" DESC);

UPDATE "User"
SET "credits_balance" = 105
WHERE "is_verified" = true AND "credits_balance" = 0;
