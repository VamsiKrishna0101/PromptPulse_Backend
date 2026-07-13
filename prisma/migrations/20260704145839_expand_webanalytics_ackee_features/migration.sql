-- CreateEnum
CREATE TYPE "WebAnalyticsCustomEventType" AS ENUM ('TOTAL_CHART', 'AVERAGE_CHART', 'TOTAL_LIST', 'AVERAGE_LIST');

-- AlterTable
ALTER TABLE "WebAnalyticsSession" ADD COLUMN "browser_version" TEXT;
ALTER TABLE "WebAnalyticsSession" ADD COLUMN "browser_width" INTEGER;
ALTER TABLE "WebAnalyticsSession" ADD COLUMN "browser_height" INTEGER;
ALTER TABLE "WebAnalyticsSession" ADD COLUMN "os_version" TEXT;
ALTER TABLE "WebAnalyticsSession" ADD COLUMN "language" TEXT;
ALTER TABLE "WebAnalyticsSession" ADD COLUMN "screen_width" INTEGER;
ALTER TABLE "WebAnalyticsSession" ADD COLUMN "screen_height" INTEGER;
ALTER TABLE "WebAnalyticsSession" ADD COLUMN "screen_color_depth" INTEGER;

-- CreateTable
CREATE TABLE "WebAnalyticsCustomEvent" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "WebAnalyticsCustomEventType" NOT NULL DEFAULT 'TOTAL_CHART',
    "key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebAnalyticsCustomEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAnalyticsAction" (
    "id" TEXT NOT NULL,
    "custom_event_id" TEXT NOT NULL,
    "session_id" TEXT,
    "key" TEXT,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebAnalyticsAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebAnalyticsCustomEvent_site_id_idx" ON "WebAnalyticsCustomEvent"("site_id");

-- CreateIndex
CREATE INDEX "WebAnalyticsAction_custom_event_id_created_at_idx" ON "WebAnalyticsAction"("custom_event_id", "created_at");

-- CreateIndex
CREATE INDEX "WebAnalyticsAction_session_id_idx" ON "WebAnalyticsAction"("session_id");

-- AddForeignKey
ALTER TABLE "WebAnalyticsCustomEvent" ADD CONSTRAINT "WebAnalyticsCustomEvent_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "WebAnalyticsSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAnalyticsAction" ADD CONSTRAINT "WebAnalyticsAction_custom_event_id_fkey" FOREIGN KEY ("custom_event_id") REFERENCES "WebAnalyticsCustomEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAnalyticsAction" ADD CONSTRAINT "WebAnalyticsAction_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "WebAnalyticsSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
