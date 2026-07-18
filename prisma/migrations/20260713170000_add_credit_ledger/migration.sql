CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditLedgerEntry_idempotency_key_key" ON "CreditLedgerEntry"("idempotency_key");
CREATE INDEX "CreditLedgerEntry_user_id_period_start_period_end_idx" ON "CreditLedgerEntry"("user_id", "period_start", "period_end");
CREATE INDEX "CreditLedgerEntry_user_id_action_created_at_idx" ON "CreditLedgerEntry"("user_id", "action", "created_at");

ALTER TABLE "CreditLedgerEntry"
ADD CONSTRAINT "CreditLedgerEntry_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
