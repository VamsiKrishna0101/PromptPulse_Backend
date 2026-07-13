-- CreateEnum
CREATE TYPE "WebAnalyticsEventType" AS ENUM ('PAGE_VIEW', 'CUSTOM');

-- CreateTable
CREATE TABLE "WebAnalyticsSite" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebAnalyticsSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAnalyticsSession" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "browser" TEXT,
    "os" TEXT,
    "device" TEXT,
    "country" TEXT,
    "referrer" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "landing_page" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "session_id" TEXT,
    "type" "WebAnalyticsEventType" NOT NULL DEFAULT 'PAGE_VIEW',
    "path" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "referrer" TEXT,
    "event_name" TEXT,
    "event_value" JSONB,
    "duration_ms" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebAnalyticsSite_public_key_key" ON "WebAnalyticsSite"("public_key");

-- CreateIndex
CREATE INDEX "WebAnalyticsSite_project_id_idx" ON "WebAnalyticsSite"("project_id");

-- CreateIndex
CREATE INDEX "WebAnalyticsSite_public_key_idx" ON "WebAnalyticsSite"("public_key");

-- CreateIndex
CREATE UNIQUE INDEX "WebAnalyticsSession_site_id_visitor_id_key" ON "WebAnalyticsSession"("site_id", "visitor_id");

-- CreateIndex
CREATE INDEX "WebAnalyticsSession_site_id_last_seen_at_idx" ON "WebAnalyticsSession"("site_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "WebAnalyticsEvent_site_id_created_at_idx" ON "WebAnalyticsEvent"("site_id", "created_at");

-- CreateIndex
CREATE INDEX "WebAnalyticsEvent_site_id_type_created_at_idx" ON "WebAnalyticsEvent"("site_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "WebAnalyticsEvent_session_id_idx" ON "WebAnalyticsEvent"("session_id");

-- AddForeignKey
ALTER TABLE "WebAnalyticsSite" ADD CONSTRAINT "WebAnalyticsSite_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAnalyticsSession" ADD CONSTRAINT "WebAnalyticsSession_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "WebAnalyticsSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAnalyticsEvent" ADD CONSTRAINT "WebAnalyticsEvent_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "WebAnalyticsSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAnalyticsEvent" ADD CONSTRAINT "WebAnalyticsEvent_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "WebAnalyticsSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
