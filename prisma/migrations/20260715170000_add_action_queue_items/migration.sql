CREATE TABLE IF NOT EXISTS "ActionQueueItem" (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'OPEN',
    impact_score INTEGER NOT NULL DEFAULT 0,
    effort_score INTEGER NOT NULL DEFAULT 0,
    confidence_score INTEGER NOT NULL DEFAULT 0,
    recommended_action TEXT,
    success_metric TEXT,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_type TEXT,
    source_ref_id TEXT,
    due_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "ActionQueueItem_project_user_status_priority_idx"
    ON "ActionQueueItem"(project_id, user_id, status, priority);

CREATE INDEX IF NOT EXISTS "ActionQueueItem_project_user_updated_idx"
    ON "ActionQueueItem"(project_id, user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS "ActionQueueItem_user_status_idx"
    ON "ActionQueueItem"(user_id, status);
