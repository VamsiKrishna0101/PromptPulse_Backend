CREATE TABLE "SeoDomainResearchKeywordGapSnapshot" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "target_domain" TEXT NOT NULL,
    "competitor_domain" TEXT NOT NULL,
    "location_code" INTEGER NOT NULL,
    "country_iso_code" TEXT NOT NULL,
    "language_code" TEXT NOT NULL,
    "item_limit" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "provider_environment" TEXT NOT NULL,
    "provider_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "provider_task_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoDomainResearchKeywordGapSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoDomainResearchKeywordGapSnapshot_project_target_competitor_market_fetched_idx"
ON "SeoDomainResearchKeywordGapSnapshot"(
    "project_id",
    "target_domain",
    "competitor_domain",
    "location_code",
    "language_code",
    "fetched_at"
);

CREATE INDEX "SeoDomainResearchKeywordGapSnapshot_expires_at_idx"
ON "SeoDomainResearchKeywordGapSnapshot"("expires_at");

ALTER TABLE "SeoDomainResearchKeywordGapSnapshot"
ADD CONSTRAINT "SeoDomainResearchKeywordGapSnapshot_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoDomainResearchKeywordGapSnapshot"
ADD CONSTRAINT "SeoDomainResearchKeywordGapSnapshot_requested_by_user_id_fkey"
FOREIGN KEY ("requested_by_user_id") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
