CREATE INDEX IF NOT EXISTS "Chat_prompt_id_brand_mentioned_created_at_idx"
ON "Chat"("prompt_id", "brand_mentioned", "created_at");

CREATE INDEX IF NOT EXISTS "Chat_prompt_id_geo_country_code_created_at_idx"
ON "Chat"("prompt_id", "geo_country_code", "created_at");

CREATE INDEX IF NOT EXISTS "Chat_prompt_id_ai_model_created_at_idx"
ON "Chat"("prompt_id", "ai_model", "created_at");

CREATE INDEX IF NOT EXISTS "Source_chat_id_is_cited_idx"
ON "Source"("chat_id", "is_cited");

CREATE INDEX IF NOT EXISTS "Source_chat_id_created_at_idx"
ON "Source"("chat_id", "created_at");

CREATE INDEX IF NOT EXISTS "BrandMention_chat_id_brand_name_idx"
ON "BrandMention"("chat_id", "brand_name");

CREATE INDEX IF NOT EXISTS "RedditPost_project_id_user_id_importance_score_num_comments_idx"
ON "RedditPost"("project_id", "user_id", "importance_score", "num_comments");

CREATE INDEX IF NOT EXISTS "BookDemo_scheduledAt_idx"
ON "BookDemo"("scheduledAt");
