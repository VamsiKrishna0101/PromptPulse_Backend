CREATE TYPE "SeoV2JobStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'COMPLETED',
    'PARTIAL',
    'FAILED'
);

CREATE TYPE "SeoV2CrawlErrorCode" AS ENUM (
    'NONE',
    'DNS_FAILURE',
    'TIMEOUT',
    'ROBOTS_BLOCKED',
    'HTTP_403',
    'HTTP_404',
    'HTTP_4XX',
    'HTTP_500',
    'HTTP_5XX',
    'REDIRECT_LOOP',
    'PARSE_ERROR'
);

CREATE TYPE "SeoV2IssueSeverity" AS ENUM (
    'CRITICAL',
    'HIGH',
    'MEDIUM',
    'LOW',
    'INFO'
);

CREATE TYPE "SeoV2IssueCategory" AS ENUM (
    'INDEXABILITY',
    'REDIRECT',
    'CANONICAL',
    'TITLE',
    'META_DESCRIPTION',
    'HEADINGS',
    'IMAGES',
    'LINKS',
    'SCHEMA',
    'MOBILE',
    'DUPLICATE_CONTENT',
    'SITEMAP',
    'ROBOTS',
    'ORPHAN_PAGES',
    'CRAWL_DEPTH'
);

CREATE TYPE "SeoV2IssueVerification" AS ENUM (
    'UNVERIFIED',
    'PENDING_RECRAWL',
    'VERIFIED_FIXED',
    'VERIFIED_STILL_PRESENT'
);

CREATE TABLE "SeoCrawlJob" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'STANDARD',
    "max_pages" INTEGER NOT NULL DEFAULT 100,
    "status" "SeoV2JobStatus" NOT NULL DEFAULT 'QUEUED',
    "pages_crawled" INTEGER NOT NULL DEFAULT 0,
    "pages_queued" INTEGER NOT NULL DEFAULT 0,
    "pages_failed" INTEGER NOT NULL DEFAULT 0,
    "crawl_coverage" DOUBLE PRECISION,
    "credits_reserved" INTEGER NOT NULL DEFAULT 0,
    "credits_spent" INTEGER NOT NULL DEFAULT 0,
    "error_reason" TEXT,
    "partial_reason" TEXT,
    "robots_txt_url" TEXT,
    "robots_txt_raw" TEXT,
    "sitemap_urls_found" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoCrawlJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoV2Audit" (
    "id" TEXT NOT NULL,
    "crawl_job_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "is_partial" BOOLEAN NOT NULL DEFAULT false,
    "crawl_coverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pages_crawled" INTEGER NOT NULL DEFAULT 0,
    "pages_failed" INTEGER NOT NULL DEFAULT 0,
    "issues_count" INTEGER NOT NULL DEFAULT 0,
    "critical_count" INTEGER NOT NULL DEFAULT 0,
    "high_count" INTEGER NOT NULL DEFAULT 0,
    "medium_count" INTEGER NOT NULL DEFAULT 0,
    "low_count" INTEGER NOT NULL DEFAULT 0,
    "technical_score" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "compared_to_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoV2Audit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoV2Page" (
    "id" TEXT NOT NULL,
    "audit_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonical_url" TEXT,
    "status_code" INTEGER,
    "error_code" "SeoV2CrawlErrorCode" NOT NULL DEFAULT 'NONE',
    "redirect_chain" JSONB NOT NULL DEFAULT '[]',
    "crawl_depth" INTEGER NOT NULL DEFAULT 0,
    "inbound_links_count" INTEGER NOT NULL DEFAULT 0,
    "is_orphan" BOOLEAN NOT NULL DEFAULT false,
    "indexable" BOOLEAN NOT NULL DEFAULT true,
    "robots_blocked" BOOLEAN NOT NULL DEFAULT false,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "canonical_is_self" BOOLEAN NOT NULL DEFAULT true,
    "title" TEXT,
    "title_length" INTEGER,
    "meta_description" TEXT,
    "meta_desc_length" INTEGER,
    "h1" TEXT,
    "h1_count" INTEGER NOT NULL DEFAULT 0,
    "h2_count" INTEGER NOT NULL DEFAULT 0,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "content_hash" TEXT,
    "has_viewport" BOOLEAN NOT NULL DEFAULT false,
    "has_schema" BOOLEAN NOT NULL DEFAULT false,
    "schema_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "images_total" INTEGER NOT NULL DEFAULT 0,
    "images_missing_alt" INTEGER NOT NULL DEFAULT 0,
    "internal_links" INTEGER NOT NULL DEFAULT 0,
    "external_links" INTEGER NOT NULL DEFAULT 0,
    "page_size_bytes" INTEGER,
    "response_time_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoV2Page_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoV2Issue" (
    "id" TEXT NOT NULL,
    "audit_id" TEXT NOT NULL,
    "page_id" TEXT,
    "category" "SeoV2IssueCategory" NOT NULL,
    "severity" "SeoV2IssueSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "why_it_matters" TEXT NOT NULL,
    "recommended_fix" TEXT NOT NULL,
    "affected_pages_count" INTEGER NOT NULL DEFAULT 1,
    "example_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority_score" INTEGER NOT NULL DEFAULT 50,
    "verification" "SeoV2IssueVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoV2Issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GscConnection" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "selected_site_url" TEXT,
    "selected_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "data_freshness_date" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GscDataRow" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "country" TEXT NOT NULL DEFAULT '',
    "device" TEXT NOT NULL DEFAULT '',
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GscDataRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoCrawlJob_project_id_created_at_idx" ON "SeoCrawlJob"("project_id", "created_at");
CREATE INDEX "SeoCrawlJob_user_id_created_at_idx" ON "SeoCrawlJob"("user_id", "created_at");
CREATE INDEX "SeoCrawlJob_status_created_at_idx" ON "SeoCrawlJob"("status", "created_at");

CREATE UNIQUE INDEX "SeoV2Audit_crawl_job_id_key" ON "SeoV2Audit"("crawl_job_id");
CREATE INDEX "SeoV2Audit_project_id_created_at_idx" ON "SeoV2Audit"("project_id", "created_at");

CREATE INDEX "SeoV2Page_audit_id_idx" ON "SeoV2Page"("audit_id");
CREATE INDEX "SeoV2Page_audit_id_status_code_idx" ON "SeoV2Page"("audit_id", "status_code");
CREATE INDEX "SeoV2Page_audit_id_indexable_idx" ON "SeoV2Page"("audit_id", "indexable");
CREATE INDEX "SeoV2Page_url_idx" ON "SeoV2Page"("url");

CREATE INDEX "SeoV2Issue_audit_id_category_idx" ON "SeoV2Issue"("audit_id", "category");
CREATE INDEX "SeoV2Issue_audit_id_severity_idx" ON "SeoV2Issue"("audit_id", "severity");
CREATE INDEX "SeoV2Issue_page_id_idx" ON "SeoV2Issue"("page_id");

CREATE UNIQUE INDEX "GscConnection_project_id_user_id_key" ON "GscConnection"("project_id", "user_id");
CREATE INDEX "GscConnection_project_id_user_id_idx" ON "GscConnection"("project_id", "user_id");
CREATE INDEX "GscConnection_user_id_disconnected_at_idx" ON "GscConnection"("user_id", "disconnected_at");

CREATE UNIQUE INDEX "GscDataRow_project_id_query_page_date_country_device_key"
    ON "GscDataRow"("project_id", "query", "page", "date", "country", "device");
CREATE INDEX "GscDataRow_project_id_date_idx" ON "GscDataRow"("project_id", "date");
CREATE INDEX "GscDataRow_project_id_query_date_idx" ON "GscDataRow"("project_id", "query", "date");
CREATE INDEX "GscDataRow_project_id_page_date_idx" ON "GscDataRow"("project_id", "page", "date");
CREATE INDEX "GscDataRow_connection_id_date_idx" ON "GscDataRow"("connection_id", "date");

ALTER TABLE "SeoCrawlJob"
    ADD CONSTRAINT "SeoCrawlJob_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoCrawlJob"
    ADD CONSTRAINT "SeoCrawlJob_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoV2Audit"
    ADD CONSTRAINT "SeoV2Audit_crawl_job_id_fkey"
    FOREIGN KEY ("crawl_job_id") REFERENCES "SeoCrawlJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoV2Audit"
    ADD CONSTRAINT "SeoV2Audit_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoV2Page"
    ADD CONSTRAINT "SeoV2Page_audit_id_fkey"
    FOREIGN KEY ("audit_id") REFERENCES "SeoV2Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoV2Issue"
    ADD CONSTRAINT "SeoV2Issue_audit_id_fkey"
    FOREIGN KEY ("audit_id") REFERENCES "SeoV2Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoV2Issue"
    ADD CONSTRAINT "SeoV2Issue_page_id_fkey"
    FOREIGN KEY ("page_id") REFERENCES "SeoV2Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GscConnection"
    ADD CONSTRAINT "GscConnection_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GscConnection"
    ADD CONSTRAINT "GscConnection_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GscDataRow"
    ADD CONSTRAINT "GscDataRow_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GscDataRow"
    ADD CONSTRAINT "GscDataRow_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "GscConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
