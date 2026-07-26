ALTER TABLE "Source"
ADD COLUMN IF NOT EXISTS "source_kind" TEXT,
ADD COLUMN IF NOT EXISTS "source_position" INTEGER,
ADD COLUMN IF NOT EXISTS "answer_position" INTEGER;

CREATE INDEX IF NOT EXISTS "Source_chat_id_source_position_idx"
ON "Source"("chat_id", "source_position");
