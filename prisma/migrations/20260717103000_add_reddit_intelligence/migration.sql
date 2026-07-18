CREATE TABLE "RedditIntelligenceRun" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "credits_spent" INTEGER NOT NULL DEFAULT 0,
    "post_limit" INTEGER NOT NULL DEFAULT 25,
    "keyword_count" INTEGER NOT NULL DEFAULT 0,
    "keywords" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB,
    "themes" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "raw_result" JSONB,
    "error_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedditIntelligenceRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RedditPost" (
    "id" TEXT NOT NULL,
    "run_id" TEXT,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "post_id" TEXT,
    "url" TEXT NOT NULL,
    "subreddit" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "author" TEXT,
    "keyword" TEXT,
    "num_comments" INTEGER NOT NULL DEFAULT 0,
    "num_upvotes" INTEGER NOT NULL DEFAULT 0,
    "date_posted" TIMESTAMP(3),
    "sentiment" TEXT,
    "intent" TEXT,
    "importance_score" INTEGER NOT NULL DEFAULT 0,
    "mentioned_brands" JSONB NOT NULL DEFAULT '[]',
    "mentioned_competitors" JSONB NOT NULL DEFAULT '[]',
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RedditPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RedditIntelligenceRun_project_id_user_id_created_at_idx" ON "RedditIntelligenceRun"("project_id", "user_id", "created_at");
CREATE INDEX "RedditIntelligenceRun_user_id_created_at_idx" ON "RedditIntelligenceRun"("user_id", "created_at");
CREATE INDEX "RedditIntelligenceRun_status_created_at_idx" ON "RedditIntelligenceRun"("status", "created_at");
CREATE UNIQUE INDEX "RedditPost_project_id_url_key" ON "RedditPost"("project_id", "url");
CREATE INDEX "RedditPost_project_id_importance_score_idx" ON "RedditPost"("project_id", "importance_score");
CREATE INDEX "RedditPost_project_id_subreddit_idx" ON "RedditPost"("project_id", "subreddit");
CREATE INDEX "RedditPost_user_id_created_at_idx" ON "RedditPost"("user_id", "created_at");

ALTER TABLE "RedditIntelligenceRun" ADD CONSTRAINT "RedditIntelligenceRun_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RedditIntelligenceRun" ADD CONSTRAINT "RedditIntelligenceRun_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RedditPost" ADD CONSTRAINT "RedditPost_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "RedditIntelligenceRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RedditPost" ADD CONSTRAINT "RedditPost_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RedditPost" ADD CONSTRAINT "RedditPost_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
