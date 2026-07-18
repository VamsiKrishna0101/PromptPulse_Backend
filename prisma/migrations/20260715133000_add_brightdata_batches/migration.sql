DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BrightDataBatchStatus') THEN
        CREATE TYPE "BrightDataBatchStatus" AS ENUM (
            'PENDING',
            'TRIGGERED',
            'RUNNING',
            'SUCCESS',
            'PARTIAL_SUCCESS',
            'FAILED',
            'TIMED_OUT'
        );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BrightDataBatchItemStatus') THEN
        CREATE TYPE "BrightDataBatchItemStatus" AS ENUM (
            'QUEUED',
            'SUCCESS',
            'FAILED'
        );
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "BrightDataBatch" (
    "id" TEXT NOT NULL,
    "engine" "Engine" NOT NULL,
    "geo_country_code" TEXT,
    "scraper_id" TEXT NOT NULL,
    "snapshot_id" TEXT,
    "status" "BrightDataBatchStatus" NOT NULL DEFAULT 'PENDING',
    "input_count" INTEGER NOT NULL,
    "completed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error_reason" TEXT,
    "triggered_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3),
    "next_poll_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrightDataBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BrightDataBatchItem" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "scrape_job_id" TEXT NOT NULL,
    "input_index" INTEGER NOT NULL,
    "status" "BrightDataBatchItemStatus" NOT NULL DEFAULT 'QUEUED',
    "error_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrightDataBatchItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrightDataBatch_snapshot_id_key" ON "BrightDataBatch"("snapshot_id");
CREATE INDEX IF NOT EXISTS "BrightDataBatch_status_next_poll_at_idx" ON "BrightDataBatch"("status", "next_poll_at");
CREATE INDEX IF NOT EXISTS "BrightDataBatch_engine_geo_country_code_created_at_idx" ON "BrightDataBatch"("engine", "geo_country_code", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "BrightDataBatchItem_scrape_job_id_key" ON "BrightDataBatchItem"("scrape_job_id");
CREATE UNIQUE INDEX IF NOT EXISTS "BrightDataBatchItem_batch_id_input_index_key" ON "BrightDataBatchItem"("batch_id", "input_index");
CREATE INDEX IF NOT EXISTS "BrightDataBatchItem_batch_id_status_idx" ON "BrightDataBatchItem"("batch_id", "status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BrightDataBatchItem_batch_id_fkey'
    ) THEN
        ALTER TABLE "BrightDataBatchItem"
            ADD CONSTRAINT "BrightDataBatchItem_batch_id_fkey"
            FOREIGN KEY ("batch_id") REFERENCES "BrightDataBatch"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BrightDataBatchItem_scrape_job_id_fkey'
    ) THEN
        ALTER TABLE "BrightDataBatchItem"
            ADD CONSTRAINT "BrightDataBatchItem_scrape_job_id_fkey"
            FOREIGN KEY ("scrape_job_id") REFERENCES "ScrapeJob"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
