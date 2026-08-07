CREATE TABLE "SeoProviderSnapshot" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "provider_environment" TEXT NOT NULL,
    "provider_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "provider_task_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoProviderSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoProviderSnapshot_project_feature_scope_fetched_idx"
ON "SeoProviderSnapshot"("project_id", "feature", "scope_key", "fetched_at");

CREATE INDEX "SeoProviderSnapshot_expires_at_idx"
ON "SeoProviderSnapshot"("expires_at");

ALTER TABLE "SeoProviderSnapshot"
ADD CONSTRAINT "SeoProviderSnapshot_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoProviderSnapshot"
ADD CONSTRAINT "SeoProviderSnapshot_requested_by_user_id_fkey"
FOREIGN KEY ("requested_by_user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
