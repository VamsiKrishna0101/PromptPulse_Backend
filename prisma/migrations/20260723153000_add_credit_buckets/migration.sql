CREATE TABLE IF NOT EXISTS "CreditBucket" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "amount_remaining" INTEGER NOT NULL,
  "expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditBucket_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CreditBucket_user_id_expires_at_idx" ON "CreditBucket"("user_id", "expires_at");
CREATE INDEX IF NOT EXISTS "CreditBucket_user_id_created_at_idx" ON "CreditBucket"("user_id", "created_at");
DO $$ BEGIN
  ALTER TABLE "CreditBucket" ADD CONSTRAINT "CreditBucket_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
