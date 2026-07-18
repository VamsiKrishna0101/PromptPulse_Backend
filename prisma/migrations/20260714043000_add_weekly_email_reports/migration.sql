CREATE TABLE "WeeklyEmailReport" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "pdf_filename" TEXT,
    "brevo_message_id" TEXT,
    "error_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyEmailReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WeeklyEmailReport_project_id_period_start_period_end_key"
ON "WeeklyEmailReport"("project_id", "period_start", "period_end");

CREATE INDEX "WeeklyEmailReport_user_id_created_at_idx"
ON "WeeklyEmailReport"("user_id", "created_at");

CREATE INDEX "WeeklyEmailReport_project_id_created_at_idx"
ON "WeeklyEmailReport"("project_id", "created_at");

CREATE INDEX "WeeklyEmailReport_status_created_at_idx"
ON "WeeklyEmailReport"("status", "created_at");

ALTER TABLE "WeeklyEmailReport"
ADD CONSTRAINT "WeeklyEmailReport_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WeeklyEmailReport"
ADD CONSTRAINT "WeeklyEmailReport_project_id_fkey"
FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
