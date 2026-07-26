CREATE TABLE "SeoAudit" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "overall_score" INTEGER NOT NULL DEFAULT 0,
    "technical_score" INTEGER NOT NULL DEFAULT 0,
    "ai_readiness_score" INTEGER NOT NULL DEFAULT 0,
    "local_score" INTEGER NOT NULL DEFAULT 0,
    "content_score" INTEGER NOT NULL DEFAULT 0,
    "schema_score" INTEGER NOT NULL DEFAULT 0,
    "credits_spent" INTEGER NOT NULL DEFAULT 0,
    "error_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoAuditPage" (
    "id" TEXT NOT NULL,
    "audit_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status_code" INTEGER,
    "title" TEXT,
    "meta_description" TEXT,
    "h1" TEXT,
    "canonical" TEXT,
    "word_count" INTEGER NOT NULL DEFAULT 0,
    "indexable" BOOLEAN NOT NULL DEFAULT true,
    "has_viewport" BOOLEAN NOT NULL DEFAULT false,
    "has_schema" BOOLEAN NOT NULL DEFAULT false,
    "has_faq" BOOLEAN NOT NULL DEFAULT false,
    "detected_services" JSONB NOT NULL DEFAULT '[]',
    "detected_locations" JSONB NOT NULL DEFAULT '[]',
    "page_type" TEXT NOT NULL DEFAULT 'OTHER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoAuditPage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoIssue" (
    "id" TEXT NOT NULL,
    "audit_id" TEXT NOT NULL,
    "page_id" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "priority_score" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeoIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoAction" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "audit_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "related_prompt_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "related_sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeoAudit_project_id_created_at_idx" ON "SeoAudit"("project_id", "created_at");
CREATE INDEX "SeoAudit_user_id_created_at_idx" ON "SeoAudit"("user_id", "created_at");
CREATE INDEX "SeoAuditPage_audit_id_idx" ON "SeoAuditPage"("audit_id");
CREATE INDEX "SeoAuditPage_url_idx" ON "SeoAuditPage"("url");
CREATE INDEX "SeoIssue_audit_id_category_idx" ON "SeoIssue"("audit_id", "category");
CREATE INDEX "SeoIssue_audit_id_severity_idx" ON "SeoIssue"("audit_id", "severity");
CREATE INDEX "SeoAction_project_id_status_idx" ON "SeoAction"("project_id", "status");
CREATE INDEX "SeoAction_audit_id_idx" ON "SeoAction"("audit_id");

ALTER TABLE "SeoAudit" ADD CONSTRAINT "SeoAudit_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoAudit" ADD CONSTRAINT "SeoAudit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoAuditPage" ADD CONSTRAINT "SeoAuditPage_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "SeoAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoIssue" ADD CONSTRAINT "SeoIssue_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "SeoAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoIssue" ADD CONSTRAINT "SeoIssue_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "SeoAuditPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeoAction" ADD CONSTRAINT "SeoAction_audit_id_fkey" FOREIGN KEY ("audit_id") REFERENCES "SeoAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
