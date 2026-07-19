CREATE INDEX "Project_user_id_created_at_idx" ON "Project"("user_id", "created_at");

CREATE INDEX "Prompt_project_id_is_active_status_idx" ON "Prompt"("project_id", "is_active", "status");
CREATE INDEX "Prompt_project_id_created_at_idx" ON "Prompt"("project_id", "created_at");

CREATE INDEX "Competitor_project_id_created_at_idx" ON "Competitor"("project_id", "created_at");

CREATE INDEX "Run_project_id_ran_at_idx" ON "Run"("project_id", "ran_at");
CREATE INDEX "Run_status_scheduled_for_idx" ON "Run"("status", "scheduled_for");

CREATE INDEX "Chat_run_id_created_at_idx" ON "Chat"("run_id", "created_at");
CREATE INDEX "Chat_prompt_id_created_at_idx" ON "Chat"("prompt_id", "created_at");
CREATE INDEX "Chat_ai_model_created_at_idx" ON "Chat"("ai_model", "created_at");

CREATE INDEX "ScrapeJob_run_id_status_idx" ON "ScrapeJob"("run_id", "status");
CREATE INDEX "ScrapeJob_project_id_status_created_at_idx" ON "ScrapeJob"("project_id", "status", "created_at");
CREATE INDEX "ScrapeJob_status_scheduled_for_idx" ON "ScrapeJob"("status", "scheduled_for");

CREATE INDEX "BrandMention_chat_id_idx" ON "BrandMention"("chat_id");
CREATE INDEX "BrandMention_brand_name_chat_id_idx" ON "BrandMention"("brand_name", "chat_id");

CREATE INDEX "Source_chat_id_domain_idx" ON "Source"("chat_id", "domain");
CREATE INDEX "Source_domain_created_at_idx" ON "Source"("domain", "created_at");
CREATE INDEX "Source_source_url_content_id_idx" ON "Source"("source_url_content_id");

CREATE INDEX "SourceUrlContent_domain_fetch_status_idx" ON "SourceUrlContent"("domain", "fetch_status");
CREATE INDEX "SourceUrlContent_updated_at_idx" ON "SourceUrlContent"("updated_at");
