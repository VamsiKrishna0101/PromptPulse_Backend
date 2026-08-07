import "dotenv/config"
import pg from "pg"

const { Pool } = pg

async function applyTables() {
    const url = process.env.DATABASE_URL
    if (!url) {
        throw new Error("DATABASE_URL is not set in .env")
    }

    const pool = new Pool({ connectionString: url })

    try {
        console.log("Safely checking and creating SEO Onboarding / Strategy tables...")
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "SeoOnboardingRun" (
                "id" TEXT NOT NULL,
                "project_id" TEXT NOT NULL,
                "client_user_id" TEXT NOT NULL,
                "requested_by_user_id" TEXT NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'QUEUED',
                "current_step" TEXT NOT NULL DEFAULT 'QUEUED',
                "progress_percent" INTEGER NOT NULL DEFAULT 0,
                "max_credits" INTEGER NOT NULL DEFAULT 180,
                "credits_spent" INTEGER NOT NULL DEFAULT 0,
                "provider_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
                "audit_id" TEXT,
                "visibility_run_id" TEXT,
                "attempt_count" INTEGER NOT NULL DEFAULT 0,
                "input" JSONB NOT NULL DEFAULT '{}',
                "cost_breakdown" JSONB NOT NULL DEFAULT '{}',
                "summary" JSONB,
                "error_reason" TEXT,
                "started_at" TIMESTAMP(3),
                "completed_at" TIMESTAMP(3),
                "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "SeoOnboardingRun_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE IF NOT EXISTS "SeoOnboardingFinding" (
                "id" TEXT NOT NULL,
                "run_id" TEXT NOT NULL,
                "category" TEXT NOT NULL,
                "title" TEXT NOT NULL,
                "summary" TEXT NOT NULL,
                "severity" TEXT NOT NULL DEFAULT 'INFO',
                "evidence" JSONB NOT NULL DEFAULT '{}',
                "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "SeoOnboardingFinding_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE IF NOT EXISTS "SeoOnboardingStep" (
                "id" TEXT NOT NULL,
                "run_id" TEXT NOT NULL,
                "step_key" TEXT NOT NULL,
                "status" TEXT NOT NULL DEFAULT 'PENDING',
                "attempts" INTEGER NOT NULL DEFAULT 0,
                "result" JSONB NOT NULL DEFAULT '{}',
                "error_reason" TEXT,
                "started_at" TIMESTAMP(3),
                "completed_at" TIMESTAMP(3),
                "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "SeoOnboardingStep_pkey" PRIMARY KEY ("id")
            );

            CREATE TABLE IF NOT EXISTS "SeoOnboardingRecommendation" (
                "id" TEXT NOT NULL,
                "run_id" TEXT NOT NULL,
                "title" TEXT NOT NULL,
                "description" TEXT NOT NULL,
                "category" TEXT NOT NULL,
                "priority" TEXT NOT NULL,
                "impact_score" INTEGER NOT NULL DEFAULT 0,
                "effort_score" INTEGER NOT NULL DEFAULT 0,
                "confidence_score" INTEGER NOT NULL DEFAULT 0,
                "recommended_action" TEXT,
                "success_metric" TEXT,
                "evidence" JSONB NOT NULL DEFAULT '{}',
                "approval_status" TEXT NOT NULL DEFAULT 'PENDING',
                "action_queue_id" TEXT,
                "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT "SeoOnboardingRecommendation_pkey" PRIMARY KEY ("id")
            );

            CREATE INDEX IF NOT EXISTS "SeoOnboardingRun_project_id_created_at_idx" ON "SeoOnboardingRun"("project_id", "created_at");
            CREATE INDEX IF NOT EXISTS "SeoOnboardingRun_client_user_id_created_at_idx" ON "SeoOnboardingRun"("client_user_id", "created_at");
            CREATE INDEX IF NOT EXISTS "SeoOnboardingRun_status_created_at_idx" ON "SeoOnboardingRun"("status", "created_at");
            CREATE UNIQUE INDEX IF NOT EXISTS "SeoOnboardingRun_visibility_run_id_key" ON "SeoOnboardingRun"("visibility_run_id");
            CREATE UNIQUE INDEX IF NOT EXISTS "SeoOnboardingStep_run_id_step_key_key" ON "SeoOnboardingStep"("run_id", "step_key");
            CREATE INDEX IF NOT EXISTS "SeoOnboardingStep_run_id_status_idx" ON "SeoOnboardingStep"("run_id", "status");
            CREATE INDEX IF NOT EXISTS "SeoOnboardingFinding_run_id_category_idx" ON "SeoOnboardingFinding"("run_id", "category");
            CREATE INDEX IF NOT EXISTS "SeoOnboardingFinding_run_id_severity_idx" ON "SeoOnboardingFinding"("run_id", "severity");
            CREATE INDEX IF NOT EXISTS "SeoOnboardingRecommendation_run_id_approval_status_idx" ON "SeoOnboardingRecommendation"("run_id", "approval_status");
            CREATE INDEX IF NOT EXISTS "SeoOnboardingRecommendation_run_id_priority_idx" ON "SeoOnboardingRecommendation"("run_id", "priority");
        `)

        console.log("✅ Successfully created SEO Onboarding & Strategy tables without any data loss.")
    } catch (err) {
        console.error("Migration error:", err)
        throw err
    } finally {
        await pool.end()
    }
}

applyTables()
