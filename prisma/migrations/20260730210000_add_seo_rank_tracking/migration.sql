CREATE TABLE "SeoRankTrackingConfig" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "location_code" INTEGER NOT NULL DEFAULT 2356,
    "location_name" TEXT,
    "language_code" TEXT NOT NULL DEFAULT 'en',
    "device_mode" TEXT NOT NULL DEFAULT 'both',
    "serp_depth" INTEGER NOT NULL DEFAULT 20,
    "schedule_interval" TEXT NOT NULL DEFAULT 'weekly',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMP(3),
    "next_check_at" TIMESTAMP(3),
    "last_skip_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SeoRankTrackingConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoRankTrackingKeyword" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "search_volume" INTEGER,
    "keyword_difficulty" INTEGER,
    "cpc" DOUBLE PRECISION,
    "metrics_fetched_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeoRankTrackingKeyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoRankCheckRun" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "keywords_total" INTEGER NOT NULL DEFAULT 0,
    "keywords_checked" INTEGER NOT NULL DEFAULT 0,
    "is_subset_run" BOOLEAN NOT NULL DEFAULT false,
    "provider_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "credits_spent" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "SeoRankCheckRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoRankSnapshot" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "tracking_keyword_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "position" INTEGER,
    "previous_position" INTEGER,
    "ranking_url" TEXT,
    "serp_features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeoRankSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoRankTrackingConfig_project_id_is_active_created_at_idx"
ON "SeoRankTrackingConfig"("project_id", "is_active", "created_at");
CREATE INDEX "SeoRankTrackingConfig_next_check_at_is_active_idx"
ON "SeoRankTrackingConfig"("next_check_at", "is_active");
CREATE UNIQUE INDEX "SeoRankTrackingConfig_national_unique"
ON "SeoRankTrackingConfig"("project_id", "domain", "location_code")
WHERE "location_name" IS NULL;
CREATE UNIQUE INDEX "SeoRankTrackingConfig_local_unique"
ON "SeoRankTrackingConfig"("project_id", "domain", "location_code", "location_name")
WHERE "location_name" IS NOT NULL;

CREATE UNIQUE INDEX "SeoRankTrackingKeyword_config_id_keyword_key"
ON "SeoRankTrackingKeyword"("config_id", "keyword");
CREATE INDEX "SeoRankTrackingKeyword_config_id_created_at_idx"
ON "SeoRankTrackingKeyword"("config_id", "created_at");

CREATE INDEX "SeoRankCheckRun_config_id_started_at_idx"
ON "SeoRankCheckRun"("config_id", "started_at");
CREATE INDEX "SeoRankCheckRun_project_id_started_at_idx"
ON "SeoRankCheckRun"("project_id", "started_at");
CREATE INDEX "SeoRankCheckRun_status_started_at_idx"
ON "SeoRankCheckRun"("status", "started_at");
CREATE UNIQUE INDEX "SeoRankCheckRun_one_active_per_config_idx"
ON "SeoRankCheckRun"("config_id")
WHERE "status" IN ('PENDING', 'RUNNING');

CREATE UNIQUE INDEX "SeoRankSnapshot_run_id_tracking_keyword_id_device_key"
ON "SeoRankSnapshot"("run_id", "tracking_keyword_id", "device");
CREATE INDEX "SeoRankSnapshot_tracking_keyword_id_device_checked_at_idx"
ON "SeoRankSnapshot"("tracking_keyword_id", "device", "checked_at");
CREATE INDEX "SeoRankSnapshot_run_id_idx" ON "SeoRankSnapshot"("run_id");

ALTER TABLE "SeoRankTrackingConfig"
ADD CONSTRAINT "SeoRankTrackingConfig_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoRankTrackingKeyword"
ADD CONSTRAINT "SeoRankTrackingKeyword_config_id_fkey"
FOREIGN KEY ("config_id") REFERENCES "SeoRankTrackingConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoRankCheckRun"
ADD CONSTRAINT "SeoRankCheckRun_config_id_fkey"
FOREIGN KEY ("config_id") REFERENCES "SeoRankTrackingConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoRankCheckRun"
ADD CONSTRAINT "SeoRankCheckRun_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoRankSnapshot"
ADD CONSTRAINT "SeoRankSnapshot_run_id_fkey"
FOREIGN KEY ("run_id") REFERENCES "SeoRankCheckRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoRankSnapshot"
ADD CONSTRAINT "SeoRankSnapshot_tracking_keyword_id_fkey"
FOREIGN KEY ("tracking_keyword_id") REFERENCES "SeoRankTrackingKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
