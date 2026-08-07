CREATE TABLE "SeoDomainResearchTopPagesSnapshot" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "target_domain" TEXT NOT NULL,
    "location_code" INTEGER NOT NULL,
    "country_iso_code" TEXT NOT NULL,
    "language_code" TEXT NOT NULL,
    "item_limit" INTEGER NOT NULL,
    "total_count" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "provider_environment" TEXT NOT NULL,
    "provider_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "provider_task_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoDomainResearchTopPagesSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoDomainResearchTopPagesSnapshot_project_id_target_domain_location_code_language_code_fetched_at_idx"
ON "SeoDomainResearchTopPagesSnapshot"(
    "project_id",
    "target_domain",
    "location_code",
    "language_code",
    "fetched_at"
);

CREATE INDEX "SeoDomainResearchTopPagesSnapshot_expires_at_idx"
ON "SeoDomainResearchTopPagesSnapshot"("expires_at");

ALTER TABLE "SeoDomainResearchTopPagesSnapshot"
ADD CONSTRAINT "SeoDomainResearchTopPagesSnapshot_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoDomainResearchTopPagesSnapshot"
ADD CONSTRAINT "SeoDomainResearchTopPagesSnapshot_requested_by_user_id_fkey"
FOREIGN KEY ("requested_by_user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
