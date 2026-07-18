CREATE TABLE "BrandPreference" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "industry_category" TEXT NOT NULL,
    "buyer_persona" TEXT,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "avoid_keywords" JSONB NOT NULL DEFAULT '[]',
    "competitor_context" TEXT,
    "reddit_focus" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandPreference_project_id_key" ON "BrandPreference"("project_id");
CREATE INDEX "BrandPreference_user_id_idx" ON "BrandPreference"("user_id");
CREATE INDEX "BrandPreference_project_id_user_id_idx" ON "BrandPreference"("project_id", "user_id");

ALTER TABLE "BrandPreference" ADD CONSTRAINT "BrandPreference_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BrandPreference" ADD CONSTRAINT "BrandPreference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
