-- ============================================
-- WORKFLOWS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  
  input_schema JSONB NOT NULL DEFAULT '{}',
  output_schema JSONB NOT NULL DEFAULT '{}',
  workflow JSONB NOT NULL DEFAULT '[]',
  script_code TEXT,
  script_runtime JSONB DEFAULT '{}',
  defaults_for_required_parameters JSONB DEFAULT '{}',
  
  toolkit_ids TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  is_public BOOLEAN DEFAULT FALSE,
  
  CONSTRAINT workflow_owner CHECK (length(trim(user_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_is_active ON workflows(is_active);

-- ============================================
-- SCHEDULED_WORKFLOWS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS scheduled_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  cron_timezone TEXT DEFAULT 'Asia/Kolkata',
  
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  is_enabled BOOLEAN DEFAULT TRUE,
  
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  total_runs INTEGER DEFAULT 0,
  successful_runs INTEGER DEFAULT 0,
  failed_runs INTEGER DEFAULT 0,
  
  params JSONB DEFAULT '{}',
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  CONSTRAINT schedule_owner CHECK (length(trim(user_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_user_id ON scheduled_workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_workflow_id ON scheduled_workflows(workflow_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_status ON scheduled_workflows(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_next_run ON scheduled_workflows(next_run_at);

-- Manual/ad-hoc runs: workflow_run creates a disabled schedule named __engine_manual__ when no cron exists,
-- so execution_logs.scheduled_workflow_id FK is satisfied without forcing users to add a fake cron first.

-- ============================================
-- EXECUTION_LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_workflow_id UUID NOT NULL REFERENCES scheduled_workflows(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'failed', 'timeout', 'cancelled')),
  
  input_data JSONB,
  output_data JSONB,
  
  error_message TEXT,
  error_code TEXT,
  error_stack JSONB,
  
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration_ms INTEGER,
  
  triggered_by TEXT DEFAULT 'scheduler',
  job_id TEXT UNIQUE,
  retry_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT execution_owner CHECK (length(trim(user_id)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_execution_logs_scheduled_workflow ON execution_logs(scheduled_workflow_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_user_id ON execution_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_execution_logs_status ON execution_logs(status);
CREATE INDEX IF NOT EXISTS idx_execution_logs_created_at ON execution_logs(created_at);

-- ============================================
-- WORKFLOW_STEPS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  
  step_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  
  toolkit TEXT NOT NULL,
  tool_slug TEXT NOT NULL,
  tool_arguments JSONB NOT NULL DEFAULT '{}',
  
  depends_on_step_id UUID REFERENCES workflow_steps(id),
  run_if_condition JSONB,
  retry_on_failure BOOLEAN DEFAULT TRUE,
  max_retries INTEGER DEFAULT 3,
  timeout_seconds INTEGER DEFAULT 300,
  
  output_mapping JSONB,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT valid_step_number CHECK (step_number > 0),
  UNIQUE(workflow_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow_id ON workflow_steps(workflow_id);

-- ============================================
-- WEBHOOK_TRIGGERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS webhook_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_workflow_id UUID NOT NULL REFERENCES scheduled_workflows(id) ON DELETE CASCADE,
  
  webhook_url TEXT NOT NULL UNIQUE,
  webhook_secret TEXT NOT NULL,
  
  allowed_ips TEXT[],
  rate_limit INTEGER DEFAULT 100,
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_triggers_webhook_url ON webhook_triggers(webhook_url);

-- ============================================
-- AUDIT_LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  changes JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Increment successful runs
CREATE OR REPLACE FUNCTION increment_successful_runs(schedule_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE scheduled_workflows
  SET
    successful_runs = successful_runs + 1,
    total_runs = total_runs + 1,
    last_run_at = NOW()
  WHERE id = schedule_id;
END;
$$ LANGUAGE plpgsql;

-- Increment failed runs
CREATE OR REPLACE FUNCTION increment_failed_runs(schedule_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE scheduled_workflows
  SET
    failed_runs = failed_runs + 1,
    total_runs = total_runs + 1,
    last_run_at = NOW()
  WHERE id = schedule_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- WORKFLOW USER API KEYS (engine + MCP Bearer)
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_email TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_user_api_keys_hash_active
  ON workflow_user_api_keys(key_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workflow_user_api_keys_user_id ON workflow_user_api_keys(user_id);

ALTER TABLE workflow_user_api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_api_keys_select_own" ON workflow_user_api_keys;
DROP POLICY IF EXISTS "workflow_api_keys_insert_own" ON workflow_user_api_keys;
DROP POLICY IF EXISTS "workflow_api_keys_update_own" ON workflow_user_api_keys;

CREATE POLICY "workflow_api_keys_select_own"
  ON workflow_user_api_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "workflow_api_keys_insert_own"
  ON workflow_user_api_keys FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "workflow_api_keys_update_own"
  ON workflow_user_api_keys FOR UPDATE
  USING (auth.uid() = user_id);

-- Add owner_email when the table already existed without it (fixes PostgREST "schema cache" errors)
ALTER TABLE workflow_user_api_keys ADD COLUMN IF NOT EXISTS owner_email TEXT;

UPDATE workflow_user_api_keys AS k
SET owner_email = lower(trim(u.email::text))
FROM auth.users AS u
WHERE k.user_id = u.id
  AND (k.owner_email IS NULL OR btrim(k.owner_email) = '');

DELETE FROM workflow_user_api_keys
WHERE owner_email IS NULL OR btrim(owner_email) = '';

ALTER TABLE workflow_user_api_keys ALTER COLUMN owner_email SET NOT NULL;

-- Legacy cleanup (safe if columns were never created)
DROP INDEX IF EXISTS idx_audit_logs_external_user_id;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS external_user_id;

DROP INDEX IF EXISTS idx_workflows_runner_user_id;
DROP INDEX IF EXISTS idx_scheduled_workflows_runner_user_id;
DROP INDEX IF EXISTS idx_execution_logs_runner_user_id;
ALTER TABLE workflows DROP COLUMN IF EXISTS runner_user_id;
ALTER TABLE scheduled_workflows DROP COLUMN IF EXISTS runner_user_id;
ALTER TABLE execution_logs DROP COLUMN IF EXISTS runner_user_id;
