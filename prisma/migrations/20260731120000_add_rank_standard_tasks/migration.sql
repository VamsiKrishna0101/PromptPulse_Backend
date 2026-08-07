ALTER TABLE "SeoRankCheckRun"
ADD COLUMN "provider_mode" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN "provider_task_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "provider_task_map" JSONB NOT NULL DEFAULT '[]'::jsonb;
