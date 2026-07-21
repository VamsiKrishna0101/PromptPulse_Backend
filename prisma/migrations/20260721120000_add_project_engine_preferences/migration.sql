CREATE TABLE "ProjectEnginePreference" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "engine" "Engine" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEnginePreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectEnginePreference_project_id_engine_key" ON "ProjectEnginePreference"("project_id", "engine");
CREATE INDEX "ProjectEnginePreference_project_id_is_active_idx" ON "ProjectEnginePreference"("project_id", "is_active");

ALTER TABLE "ProjectEnginePreference"
ADD CONSTRAINT "ProjectEnginePreference_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProjectEnginePreference" ("id", "project_id", "engine", "is_active", "created_at", "updated_at")
SELECT p."id" || ':' || e."engine", p."id", e."engine"::"Engine", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Project" p
CROSS JOIN (VALUES ('CHATGPT'), ('GEMINI'), ('PERPLEXITY')) AS e("engine")
ON CONFLICT ("project_id", "engine") DO NOTHING;
