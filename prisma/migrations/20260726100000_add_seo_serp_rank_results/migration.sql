CREATE TABLE "SeoRankResult" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "audit_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "target_domain" TEXT NOT NULL,
    "google_rank" INTEGER,
    "ranking_url" TEXT,
    "ranking_title" TEXT,
    "organic_results" JSONB NOT NULL DEFAULT '[]',
    "related_queries" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "error_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoRankResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeoRankResult_audit_id_keyword_key" ON "SeoRankResult"("audit_id", "keyword");
CREATE INDEX "SeoRankResult_project_id_created_at_idx" ON "SeoRankResult"("project_id", "created_at");
CREATE INDEX "SeoRankResult_audit_id_idx" ON "SeoRankResult"("audit_id");

ALTER TABLE "SeoRankResult" ADD CONSTRAINT "SeoRankResult_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "SeoAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
