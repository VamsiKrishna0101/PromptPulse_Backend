CREATE TABLE IF NOT EXISTS "PublicChatLead" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "company" TEXT,
    "message" TEXT NOT NULL,
    "topic" TEXT,
    "page_path" TEXT,
    "user_agent" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicChatLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PublicChatLead_email_created_at_idx"
ON "PublicChatLead"("email", "created_at");

CREATE INDEX IF NOT EXISTS "PublicChatLead_topic_created_at_idx"
ON "PublicChatLead"("topic", "created_at");

CREATE INDEX IF NOT EXISTS "PublicChatLead_created_at_idx"
ON "PublicChatLead"("created_at");
