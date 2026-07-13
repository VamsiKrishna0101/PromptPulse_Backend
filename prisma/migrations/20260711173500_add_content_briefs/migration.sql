CREATE TABLE IF NOT EXISTS "ContentBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "topic" TEXT,
    "target_prompt_id" TEXT,
    "target_prompt_text" TEXT NOT NULL,
    "content_type" TEXT,
    "action" TEXT,
    "opportunity_offset" INTEGER NOT NULL DEFAULT 0,
    "brief" JSONB NOT NULL,
    "article" JSONB,
    "prompt_used" JSONB,
    "generation_error" TEXT,
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT "ContentBrief_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE,
    CONSTRAINT "ContentBrief_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentBrief_project_user_prompt_offset_key"
ON "ContentBrief"("project_id", "user_id", "target_prompt_id", "opportunity_offset");

CREATE INDEX IF NOT EXISTS "ContentBrief_project_user_updated_idx"
ON "ContentBrief"("project_id", "user_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "ContentBrief_user_updated_idx"
ON "ContentBrief"("user_id", "updated_at" DESC);
