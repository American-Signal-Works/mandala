-- Agent workflow harness foundation.
-- Procurement is represented only as the first fixture workflow type; durable tables use generic workflow names.

CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE company_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','approver','member','viewer','agent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

CREATE INDEX company_memberships_user_idx
  ON company_memberships (user_id, company_id)
  WHERE status = 'active';

CREATE OR REPLACE FUNCTION public.company_role_rank(role TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE role
    WHEN 'owner' THEN 60
    WHEN 'admin' THEN 50
    WHEN 'approver' THEN 40
    WHEN 'member' THEN 30
    WHEN 'viewer' THEN 20
    WHEN 'agent' THEN 10
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION public.has_company_role(target_company_id UUID, minimum_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM company_memberships cm
    WHERE cm.company_id = target_company_id
      AND cm.user_id = (SELECT auth.uid())
      AND cm.status = 'active'
      AND public.company_role_rank(cm.role) >= public.company_role_rank(minimum_role)
  )
$$;

CREATE TABLE company_approval_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL,
  action_type TEXT NOT NULL,
  minimum_role TEXT NOT NULL DEFAULT 'approver'
    CHECK (minimum_role IN ('owner','admin','approver')),
  require_human_approval BOOLEAN NOT NULL DEFAULT true,
  require_warning_acknowledgement BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, workflow_type, action_type)
);

-- Database-owned fixture adapter contracts prevent callers from turning the
-- generic fixture RPC into arbitrary workflow or audit record insertion.
CREATE TABLE workflow_fixture_adapters (
  adapter_key TEXT PRIMARY KEY,
  workflow_key TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  version TEXT NOT NULL,
  allowed_scenario_ids TEXT[] NOT NULL,
  allowed_trigger_kinds TEXT[] NOT NULL,
  allowed_event_types TEXT[] NOT NULL,
  allowed_item_types TEXT[] NOT NULL,
  allowed_action_types TEXT[] NOT NULL,
  allowed_audit_event_types TEXT[] NOT NULL,
  allowed_node_kinds TEXT[] NOT NULL,
  allowed_tools TEXT[] NOT NULL,
  canonical_edit_policy JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_key, workflow_type, version)
);

INSERT INTO workflow_fixture_adapters (
  adapter_key,
  workflow_key,
  workflow_type,
  version,
  allowed_scenario_ids,
  allowed_trigger_kinds,
  allowed_event_types,
  allowed_item_types,
  allowed_action_types,
  allowed_audit_event_types,
  allowed_node_kinds,
  allowed_tools,
  canonical_edit_policy
)
VALUES (
  'procurement_reorder_fixture_v1',
  'procurement_reorder_review',
  'procurement_reorder',
  '0.1.0',
  ARRAY['clean_reorder','sales_spike_warning','duplicate_open_order','stale_inventory','no_action','edit_reorder','reject_reorder'],
  ARRAY['fixture'],
  ARRAY['fixture_inventory_snapshot'],
  ARRAY['procurement_reorder_review'],
  ARRAY['create_mock_purchase_order_draft','execute_mock_purchase_order'],
  ARRAY['event_validated','item_suppressed','item_duplicate_suppressed','recommendation_created'],
  ARRAY['source_sync','validation','routing','context_assembly','recommendation','draft_action','human_approval','mock_execution','audit'],
  ARRAY[
    'read_fixture_records',
    'validate_fixture_event',
    'route_work_item',
    'assemble_context_packet',
    'compute_reorder_recommendation',
    'create_mock_action_draft',
    'record_human_decision',
    'execute_mock_action',
    'write_workflow_audit_event'
  ],
  '{"editable":true,"requireReason":true,"immutablePaths":[["vendor"],["mode"],["lines","0","sku"]],"arrayLengthPaths":[["lines"]],"positiveIntegerPaths":[["lines","0","quantity"]],"nonEmptyStringPaths":[["lines","0","reason"]]}'::jsonb
);

CREATE TABLE agent_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_key TEXT NOT NULL,
  workflow_type TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  spec JSONB NOT NULL,
  skill_markdown TEXT,
  compile_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, workflow_key, version)
);

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES agent_workflows(id) ON DELETE RESTRICT,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started','suppressed','blocked','waiting_for_approval','approved','rejected','rework_requested','executed','failed')),
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  langgraph_thread_id TEXT,
  langgraph_checkpoint_id TEXT,
  langsmith_trace_id TEXT,
  langsmith_run_id TEXT,
  started_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX workflow_runs_company_status_idx
  ON workflow_runs (company_id, status, started_at DESC);

CREATE TABLE workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES agent_workflows(id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('fixture','manual','connector','schedule','webhook')),
  source_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  freshness_state TEXT NOT NULL CHECK (freshness_state IN ('fresh','stale','unknown')),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('pass','warn','blocked')),
  validation_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, event_key)
);

CREATE INDEX workflow_events_run_idx
  ON workflow_events (workflow_run_id, created_at DESC);

CREATE TABLE workflow_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_event_id UUID NOT NULL REFERENCES workflow_events(id) ON DELETE RESTRICT,
  workflow_id UUID NOT NULL REFERENCES agent_workflows(id) ON DELETE RESTRICT,
  item_key TEXT NOT NULL,
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','blocked','approved','rejected','executed','resolved')),
  priority INT NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  related_records JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX workflow_items_active_item_key_idx
  ON workflow_items (company_id, item_key)
  WHERE status IN ('active','blocked','approved');

CREATE INDEX workflow_items_company_status_idx
  ON workflow_items (company_id, status, priority DESC, updated_at DESC);

CREATE TABLE workflow_context_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_item_id UUID NOT NULL REFERENCES workflow_items(id) ON DELETE CASCADE,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  memory_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  freshness_state TEXT NOT NULL CHECK (freshness_state IN ('fresh','stale','unknown')),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_recommendation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_item_id UUID NOT NULL REFERENCES workflow_items(id) ON DELETE CASCADE,
  context_packet_id UUID NOT NULL REFERENCES workflow_context_packets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('ready_for_review','blocked')),
  rationale_summary TEXT NOT NULL,
  warning_state TEXT NOT NULL CHECK (warning_state IN ('pass','warn','blocked')),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  freshness_state TEXT NOT NULL CHECK (freshness_state IN ('fresh','stale','unknown')),
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  langsmith_trace_id TEXT,
  langsmith_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_evidence_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_item_id UUID NOT NULL REFERENCES workflow_items(id) ON DELETE CASCADE,
  recommendation_run_id UUID NOT NULL REFERENCES workflow_recommendation_runs(id) ON DELETE CASCADE,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_action_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_item_id UUID NOT NULL REFERENCES workflow_items(id) ON DELETE CASCADE,
  recommendation_run_id UUID NOT NULL REFERENCES workflow_recommendation_runs(id) ON DELETE RESTRICT,
  evidence_snapshot_id UUID NOT NULL REFERENCES workflow_evidence_snapshots(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_review','approved','rejected','rework_requested','executed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_action_drafts_item_idx
  ON workflow_action_drafts (workflow_item_id, created_at DESC);

CREATE TABLE workflow_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_item_id UUID NOT NULL REFERENCES workflow_items(id) ON DELETE CASCADE,
  action_draft_id UUID NOT NULL REFERENCES workflow_action_drafts(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approve','edit','reject','request_rework')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','system_agent')),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  warnings_acknowledged BOOLEAN NOT NULL DEFAULT false,
  edited_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_execution_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action_draft_id UUID NOT NULL REFERENCES workflow_action_drafts(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_execution_tokens_draft_idx
  ON workflow_execution_tokens (action_draft_id, expires_at DESC);

CREATE TABLE workflow_action_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_item_id UUID NOT NULL REFERENCES workflow_items(id) ON DELETE CASCADE,
  action_draft_id UUID NOT NULL REFERENCES workflow_action_drafts(id) ON DELETE RESTRICT,
  decision_id UUID NOT NULL REFERENCES workflow_decisions(id) ON DELETE RESTRICT,
  execution_token_id UUID NOT NULL REFERENCES workflow_execution_tokens(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  action_type TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('mock','dry_run','shadow','live')),
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed')),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  mock_external_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (company_id, idempotency_key)
);

CREATE TABLE workflow_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','system_agent')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  workflow_run_id UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  workflow_item_id UUID REFERENCES workflow_items(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  trace JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_audit_events_company_created_idx
  ON workflow_audit_events (company_id, created_at DESC);
CREATE INDEX workflow_audit_events_item_idx
  ON workflow_audit_events (workflow_item_id, created_at DESC)
  WHERE workflow_item_id IS NOT NULL;

CREATE TRIGGER companies_touch BEFORE UPDATE ON companies
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER company_memberships_touch BEFORE UPDATE ON company_memberships
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER company_approval_policies_touch BEFORE UPDATE ON company_approval_policies
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER agent_workflows_touch BEFORE UPDATE ON agent_workflows
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER workflow_items_touch BEFORE UPDATE ON workflow_items
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER workflow_action_drafts_touch BEFORE UPDATE ON workflow_action_drafts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_fixture_adapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_context_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_recommendation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_evidence_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_action_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_execution_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_action_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_insert_own ON companies
  FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()));

CREATE POLICY companies_creator_select ON companies
  FOR SELECT TO authenticated
  USING (created_by = (SELECT auth.uid()));

CREATE POLICY companies_member_select ON companies
  FOR SELECT TO authenticated
  USING (public.has_company_role(id, 'viewer'));

CREATE POLICY companies_admin_update ON companies
  FOR UPDATE TO authenticated
  USING (public.has_company_role(id, 'admin'))
  WITH CHECK (public.has_company_role(id, 'admin'));

CREATE POLICY company_memberships_self_select ON company_memberships
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY company_memberships_bootstrap_owner ON company_memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = 'owner'
    AND EXISTS (
      SELECT 1
      FROM companies c
      WHERE c.id = company_id
        AND c.created_by = (SELECT auth.uid())
    )
  );

CREATE POLICY company_memberships_self_disable ON company_memberships
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'disabled');

CREATE POLICY company_approval_policies_member_select ON company_approval_policies
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY company_approval_policies_admin_write ON company_approval_policies
  FOR ALL TO authenticated
  USING (public.has_company_role(company_id, 'admin'))
  WITH CHECK (public.has_company_role(company_id, 'admin'));

CREATE POLICY workflow_fixture_adapters_authenticated_select ON workflow_fixture_adapters
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY agent_workflows_member_select ON agent_workflows
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY agent_workflows_member_insert ON agent_workflows
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY agent_workflows_member_update ON agent_workflows
  FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, 'member'))
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_runs_member_select ON workflow_runs
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_runs_member_insert ON workflow_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_runs_member_update ON workflow_runs
  FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, 'member'))
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_events_member_select ON workflow_events
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_events_member_insert ON workflow_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_items_member_select ON workflow_items
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_items_member_insert ON workflow_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_items_member_update ON workflow_items
  FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, 'member'))
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_context_packets_member_select ON workflow_context_packets
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_context_packets_member_insert ON workflow_context_packets
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_recommendation_runs_member_select ON workflow_recommendation_runs
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_recommendation_runs_member_insert ON workflow_recommendation_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_evidence_snapshots_member_select ON workflow_evidence_snapshots
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_evidence_snapshots_member_insert ON workflow_evidence_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_action_drafts_member_select ON workflow_action_drafts
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_action_drafts_member_insert ON workflow_action_drafts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_action_drafts_member_update ON workflow_action_drafts
  FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, 'member'))
  WITH CHECK (public.has_company_role(company_id, 'member'));

CREATE POLICY workflow_decisions_member_select ON workflow_decisions
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_decisions_approver_insert ON workflow_decisions
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_type = 'user'
    AND decided_by = (SELECT auth.uid())
    AND public.has_company_role(company_id, 'approver')
  );

CREATE POLICY workflow_execution_tokens_member_select ON workflow_execution_tokens
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_execution_tokens_approver_insert ON workflow_execution_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.has_company_role(company_id, 'approver')
  );

CREATE POLICY workflow_execution_tokens_approver_update ON workflow_execution_tokens
  FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, 'approver'))
  WITH CHECK (public.has_company_role(company_id, 'approver'));

CREATE POLICY workflow_action_attempts_member_select ON workflow_action_attempts
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_action_attempts_approver_insert ON workflow_action_attempts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'approver'));

CREATE POLICY workflow_audit_events_member_select ON workflow_audit_events
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY workflow_audit_events_member_insert ON workflow_audit_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'member'));

GRANT SELECT, INSERT, UPDATE ON companies TO authenticated;
GRANT SELECT, INSERT, UPDATE ON company_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE ON company_approval_policies TO authenticated;
REVOKE ALL ON workflow_fixture_adapters FROM anon, authenticated;
GRANT SELECT ON workflow_fixture_adapters TO authenticated;
GRANT SELECT, INSERT, UPDATE ON agent_workflows TO authenticated;
GRANT SELECT, INSERT, UPDATE ON workflow_runs TO authenticated;
GRANT SELECT, INSERT ON workflow_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON workflow_items TO authenticated;
GRANT SELECT, INSERT ON workflow_context_packets TO authenticated;
GRANT SELECT, INSERT ON workflow_recommendation_runs TO authenticated;
GRANT SELECT, INSERT ON workflow_evidence_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE ON workflow_action_drafts TO authenticated;
GRANT SELECT, INSERT ON workflow_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON workflow_execution_tokens TO authenticated;
GRANT SELECT, INSERT ON workflow_action_attempts TO authenticated;
GRANT SELECT, INSERT ON workflow_audit_events TO authenticated;

-- Keep tenant ownership consistent across every durable workflow relationship.
ALTER TABLE agent_workflows
  ADD CONSTRAINT agent_workflows_id_company_key UNIQUE (id, company_id);
ALTER TABLE workflow_runs
  ADD CONSTRAINT workflow_runs_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_runs_workflow_company_fkey
    FOREIGN KEY (workflow_id, company_id) REFERENCES agent_workflows (id, company_id) ON DELETE RESTRICT;
ALTER TABLE workflow_events
  ADD CONSTRAINT workflow_events_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_events_run_company_fkey
    FOREIGN KEY (workflow_run_id, company_id) REFERENCES workflow_runs (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_events_workflow_company_fkey
    FOREIGN KEY (workflow_id, company_id) REFERENCES agent_workflows (id, company_id) ON DELETE RESTRICT;
ALTER TABLE workflow_items
  ADD CONSTRAINT workflow_items_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_items_run_company_fkey
    FOREIGN KEY (workflow_run_id, company_id) REFERENCES workflow_runs (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_items_event_company_fkey
    FOREIGN KEY (workflow_event_id, company_id) REFERENCES workflow_events (id, company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workflow_items_workflow_company_fkey
    FOREIGN KEY (workflow_id, company_id) REFERENCES agent_workflows (id, company_id) ON DELETE RESTRICT;
ALTER TABLE workflow_context_packets
  ADD CONSTRAINT workflow_context_packets_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_context_packets_run_company_fkey
    FOREIGN KEY (workflow_run_id, company_id) REFERENCES workflow_runs (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_context_packets_item_company_fkey
    FOREIGN KEY (workflow_item_id, company_id) REFERENCES workflow_items (id, company_id) ON DELETE CASCADE;
ALTER TABLE workflow_recommendation_runs
  ADD CONSTRAINT workflow_recommendation_runs_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_recommendation_runs_run_company_fkey
    FOREIGN KEY (workflow_run_id, company_id) REFERENCES workflow_runs (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_recommendation_runs_item_company_fkey
    FOREIGN KEY (workflow_item_id, company_id) REFERENCES workflow_items (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_recommendation_runs_context_company_fkey
    FOREIGN KEY (context_packet_id, company_id) REFERENCES workflow_context_packets (id, company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workflow_recommendation_runs_warnings_array_check
    CHECK (jsonb_typeof(warnings) = 'array');
ALTER TABLE workflow_evidence_snapshots
  ADD CONSTRAINT workflow_evidence_snapshots_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_evidence_snapshots_run_company_fkey
    FOREIGN KEY (workflow_run_id, company_id) REFERENCES workflow_runs (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_evidence_snapshots_item_company_fkey
    FOREIGN KEY (workflow_item_id, company_id) REFERENCES workflow_items (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_evidence_snapshots_recommendation_company_fkey
    FOREIGN KEY (recommendation_run_id, company_id) REFERENCES workflow_recommendation_runs (id, company_id) ON DELETE CASCADE;
ALTER TABLE workflow_action_drafts
  ADD COLUMN edit_policy JSONB NOT NULL DEFAULT '{"editable":false,"requireReason":true,"immutablePaths":[["mode"]],"arrayLengthPaths":[]}'::jsonb,
  ADD CONSTRAINT workflow_action_drafts_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_action_drafts_run_company_fkey
    FOREIGN KEY (workflow_run_id, company_id) REFERENCES workflow_runs (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_action_drafts_item_company_fkey
    FOREIGN KEY (workflow_item_id, company_id) REFERENCES workflow_items (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_action_drafts_recommendation_company_fkey
    FOREIGN KEY (recommendation_run_id, company_id) REFERENCES workflow_recommendation_runs (id, company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workflow_action_drafts_evidence_company_fkey
    FOREIGN KEY (evidence_snapshot_id, company_id) REFERENCES workflow_evidence_snapshots (id, company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workflow_action_drafts_payload_object_check
    CHECK (jsonb_typeof(payload) = 'object');
ALTER TABLE workflow_decisions
  ADD CONSTRAINT workflow_decisions_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_decisions_action_draft_key UNIQUE (action_draft_id),
  ADD CONSTRAINT workflow_decisions_run_company_fkey
    FOREIGN KEY (workflow_run_id, company_id) REFERENCES workflow_runs (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_decisions_item_company_fkey
    FOREIGN KEY (workflow_item_id, company_id) REFERENCES workflow_items (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_decisions_draft_company_fkey
    FOREIGN KEY (action_draft_id, company_id) REFERENCES workflow_action_drafts (id, company_id) ON DELETE RESTRICT;
ALTER TABLE workflow_execution_tokens
  ADD CONSTRAINT workflow_execution_tokens_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_execution_tokens_draft_company_fkey
    FOREIGN KEY (action_draft_id, company_id) REFERENCES workflow_action_drafts (id, company_id) ON DELETE CASCADE;
ALTER TABLE workflow_action_attempts
  ADD CONSTRAINT workflow_action_attempts_execution_token_key UNIQUE (execution_token_id),
  ADD CONSTRAINT workflow_action_attempts_run_company_fkey
    FOREIGN KEY (workflow_run_id, company_id) REFERENCES workflow_runs (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_action_attempts_item_company_fkey
    FOREIGN KEY (workflow_item_id, company_id) REFERENCES workflow_items (id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT workflow_action_attempts_draft_company_fkey
    FOREIGN KEY (action_draft_id, company_id) REFERENCES workflow_action_drafts (id, company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workflow_action_attempts_decision_company_fkey
    FOREIGN KEY (decision_id, company_id) REFERENCES workflow_decisions (id, company_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workflow_action_attempts_token_company_fkey
    FOREIGN KEY (execution_token_id, company_id) REFERENCES workflow_execution_tokens (id, company_id) ON DELETE RESTRICT;

-- Workflow state is mutated only by the checked RPCs below. Direct Data API
-- writes would otherwise bypass transitions, warning acknowledgement, tokens,
-- idempotency, and audit creation.
DROP POLICY agent_workflows_member_insert ON agent_workflows;
DROP POLICY agent_workflows_member_update ON agent_workflows;
DROP POLICY workflow_runs_member_insert ON workflow_runs;
DROP POLICY workflow_runs_member_update ON workflow_runs;
DROP POLICY workflow_events_member_insert ON workflow_events;
DROP POLICY workflow_items_member_insert ON workflow_items;
DROP POLICY workflow_items_member_update ON workflow_items;
DROP POLICY workflow_context_packets_member_insert ON workflow_context_packets;
DROP POLICY workflow_recommendation_runs_member_insert ON workflow_recommendation_runs;
DROP POLICY workflow_evidence_snapshots_member_insert ON workflow_evidence_snapshots;
DROP POLICY workflow_action_drafts_member_insert ON workflow_action_drafts;
DROP POLICY workflow_action_drafts_member_update ON workflow_action_drafts;
DROP POLICY workflow_decisions_approver_insert ON workflow_decisions;
DROP POLICY workflow_execution_tokens_member_select ON workflow_execution_tokens;
DROP POLICY workflow_execution_tokens_approver_insert ON workflow_execution_tokens;
DROP POLICY workflow_execution_tokens_approver_update ON workflow_execution_tokens;
DROP POLICY workflow_action_attempts_approver_insert ON workflow_action_attempts;
DROP POLICY workflow_audit_events_member_insert ON workflow_audit_events;

REVOKE ALL ON TABLE
  agent_workflows,
  workflow_runs,
  workflow_events,
  workflow_items,
  workflow_context_packets,
  workflow_recommendation_runs,
  workflow_evidence_snapshots,
  workflow_action_drafts,
  workflow_decisions,
  workflow_execution_tokens,
  workflow_action_attempts,
  workflow_audit_events
FROM authenticated;

GRANT SELECT ON TABLE
  agent_workflows,
  workflow_runs,
  workflow_events,
  workflow_items,
  workflow_context_packets,
  workflow_recommendation_runs,
  workflow_evidence_snapshots,
  workflow_action_drafts,
  workflow_decisions,
  workflow_action_attempts,
  workflow_audit_events
TO authenticated;

REVOKE ALL ON FUNCTION public.company_role_rank(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_company_role(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_role_rank(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_company_role(UUID, TEXT) TO authenticated;

CREATE SCHEMA workflow_private;
REVOKE ALL ON SCHEMA workflow_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION workflow_private.require_company_role(
  target_company_id UUID,
  minimum_role TEXT,
  actor_user_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  membership_role TEXT;
BEGIN
  IF actor_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT cm.role
  INTO membership_role
  FROM public.company_memberships cm
  WHERE cm.company_id = target_company_id
    AND cm.user_id = actor_user_id
    AND cm.status = 'active';

  IF membership_role IS NULL
    OR public.company_role_rank(membership_role) < public.company_role_rank(minimum_role)
  THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN membership_role;
END;
$$;

CREATE FUNCTION workflow_private.persist_workflow_fixture_run(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_company_id UUID;
  definition_record JSONB := p_payload -> 'definition';
  run_record JSONB := p_payload -> 'run';
  event_record JSONB := p_payload -> 'event';
  item_record JSONB := p_payload -> 'item';
  context_record JSONB := p_payload -> 'context_packet';
  recommendation_record JSONB := p_payload -> 'recommendation';
  evidence_record JSONB := p_payload -> 'evidence';
  draft_record JSONB := p_payload -> 'draft';
  audit_records JSONB := COALESCE(p_payload -> 'audit_events', '[]'::jsonb);
  spec_record JSONB;
  adapter_record public.workflow_fixture_adapters%ROWTYPE;
  candidate_record JSONB;
  audit_record JSONB;
  definition_id UUID;
  existing_event_id UUID;
  existing_workflow_id UUID;
  existing_item_id UUID;
  duplicate_run_id UUID;
  duplicate_run JSONB;
  inserted_run JSONB;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_payload) <> 'object'
    OR p_payload ->> 'company_id' IS NULL
    OR jsonb_typeof(definition_record) <> 'object'
    OR jsonb_typeof(run_record) <> 'object'
    OR jsonb_typeof(event_record) <> 'object'
    OR jsonb_typeof(audit_records) <> 'array'
  THEN
    RAISE EXCEPTION 'invalid_fixture_payload' USING ERRCODE = '22023';
  END IF;

  target_company_id := (p_payload ->> 'company_id')::uuid;
  PERFORM workflow_private.require_company_role(target_company_id, 'member', current_user_id);

  SELECT adapter.* INTO adapter_record
  FROM public.workflow_fixture_adapters adapter
  WHERE adapter.workflow_key = definition_record ->> 'workflow_key'
    AND adapter.workflow_type = definition_record ->> 'workflow_type'
    AND adapter.version = definition_record ->> 'version';

  IF NOT FOUND
    OR NOT ((event_record #>> '{source_ref,scenarioId}') = ANY(adapter_record.allowed_scenario_ids))
    OR run_record #>> '{input,scenarioId}' IS DISTINCT FROM event_record #>> '{source_ref,scenarioId}'
    OR run_record ->> 'workflow_type' IS DISTINCT FROM adapter_record.workflow_type
    OR event_record ->> 'origin' IS DISTINCT FROM 'fixture'
    OR NOT ((event_record ->> 'event_type') = ANY(adapter_record.allowed_event_types))
    OR (
      item_record <> 'null'::jsonb
      AND NOT ((item_record ->> 'item_type') = ANY(adapter_record.allowed_item_types))
    )
  THEN
    RAISE EXCEPTION 'fixture_adapter_not_allowed' USING ERRCODE = '22023';
  END IF;

  FOR candidate_record IN
    SELECT value
    FROM jsonb_array_elements(
      jsonb_build_array(
        definition_record,
        run_record,
        event_record,
        item_record,
        context_record,
        recommendation_record,
        evidence_record,
        draft_record
      )
    )
  LOOP
    IF candidate_record <> 'null'::jsonb
      AND candidate_record ->> 'company_id' IS DISTINCT FROM target_company_id::text
    THEN
      RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(audit_records) audit_value
    WHERE audit_value ->> 'company_id' IS DISTINCT FROM target_company_id::text
  ) THEN
    RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = '22023';
  END IF;

  spec_record := definition_record -> 'spec';
  IF jsonb_typeof(spec_record) <> 'object'
    OR COALESCE((definition_record #>> '{compile_result,ok}')::boolean, false) IS NOT true
    OR spec_record ->> 'workflowKey' IS DISTINCT FROM adapter_record.workflow_key
    OR spec_record ->> 'workflowType' IS DISTINCT FROM adapter_record.workflow_type
    OR spec_record ->> 'version' IS DISTINCT FROM adapter_record.version
    OR spec_record ->> 'defaultMode' IS DISTINCT FROM 'mock'
    OR jsonb_typeof(spec_record -> 'triggers') <> 'array'
    OR jsonb_typeof(spec_record -> 'nodes') <> 'array'
    OR jsonb_typeof(spec_record -> 'allowedActions') <> 'array'
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(spec_record -> 'triggers') trigger_record
      WHERE NOT ((trigger_record ->> 'kind') = ANY(adapter_record.allowed_trigger_kinds))
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(spec_record -> 'nodes') node_record
      WHERE NOT ((node_record ->> 'kind') = ANY(adapter_record.allowed_node_kinds))
        OR jsonb_typeof(node_record -> 'allowedTools') <> 'array'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(node_record -> 'allowedTools') tool_name
          WHERE NOT (tool_name = ANY(adapter_record.allowed_tools))
        )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(adapter_record.allowed_node_kinds) required_kind
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(spec_record -> 'nodes') node_record
        WHERE node_record ->> 'kind' = required_kind
      )
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(adapter_record.allowed_tools) required_tool
      WHERE NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(spec_record -> 'nodes') node_record,
             jsonb_array_elements_text(node_record -> 'allowedTools') tool_name
        WHERE tool_name = required_tool
      )
    )
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(spec_record -> 'allowedActions') action_record
      WHERE action_record ->> 'actionType' IS NULL
        OR NOT ((action_record ->> 'actionType') = ANY(adapter_record.allowed_action_types))
        OR action_record ->> 'mode' IS DISTINCT FROM 'mock'
    )
    OR EXISTS (
      SELECT 1
      FROM unnest(adapter_record.allowed_action_types) required_action
      WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(spec_record -> 'allowedActions') action_record
        WHERE action_record ->> 'actionType' = required_action
      )
    )
  THEN
    RAISE EXCEPTION 'unsafe_workflow_spec' USING ERRCODE = '22023';
  END IF;

  IF draft_record <> 'null'::jsonb THEN
    IF NOT ((draft_record ->> 'action_type') = ANY(adapter_record.allowed_action_types))
      OR draft_record #>> '{payload,mode}' IS DISTINCT FROM 'mock'
      OR draft_record -> 'edit_policy' IS DISTINCT FROM adapter_record.canonical_edit_policy
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(spec_record -> 'allowedActions') action_record
        WHERE action_record ->> 'actionType' = draft_record ->> 'action_type'
          AND action_record ->> 'mode' = 'mock'
          AND action_record ->> 'requiresApproval' = 'true'
      )
    THEN
      RAISE EXCEPTION 'unsafe_workflow_action' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(audit_records) audit_value
    WHERE NOT ((audit_value ->> 'event_type') = ANY(adapter_record.allowed_audit_event_types))
      OR audit_value ->> 'workflow_run_id' IS DISTINCT FROM run_record ->> 'id'
      OR (
        audit_value ->> 'workflow_item_id' IS NOT NULL
        AND (
          item_record = 'null'::jsonb
          OR audit_value ->> 'workflow_item_id' IS DISTINCT FROM item_record ->> 'id'
        )
      )
  ) THEN
    RAISE EXCEPTION 'unsafe_fixture_audit' USING ERRCODE = '22023';
  END IF;

  -- Serialize identical fixture events so concurrent callers cannot both pass
  -- the duplicate precheck before the unique event insert.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_company_id::text || ':' || (event_record ->> 'event_key'), 0)
  );

  SELECT e.id, e.workflow_id, i.id
  INTO existing_event_id, existing_workflow_id, existing_item_id
  FROM public.workflow_events e
  LEFT JOIN public.workflow_items i
    ON i.workflow_event_id = e.id
    AND i.company_id = e.company_id
  WHERE e.company_id = target_company_id
    AND e.event_key = event_record ->> 'event_key'
  ORDER BY i.created_at DESC NULLS LAST
  LIMIT 1;

  IF existing_event_id IS NOT NULL THEN
    duplicate_run_id := gen_random_uuid();
    INSERT INTO public.workflow_runs (
      id,
      company_id,
      workflow_id,
      workflow_type,
      status,
      input,
      langgraph_thread_id,
      langgraph_checkpoint_id,
      langsmith_trace_id,
      langsmith_run_id,
      started_by,
      started_at,
      completed_at
    )
    VALUES (
      duplicate_run_id,
      target_company_id,
      existing_workflow_id,
      run_record ->> 'workflow_type',
      'suppressed',
      COALESCE(run_record -> 'input', '{}'::jsonb) || jsonb_build_object('duplicateOfEventId', existing_event_id),
      COALESCE(run_record ->> 'langgraph_thread_id', '') || ':duplicate:' || duplicate_run_id::text,
      COALESCE(run_record ->> 'langgraph_checkpoint_id', '') || ':duplicate:' || duplicate_run_id::text,
      COALESCE(run_record ->> 'langsmith_trace_id', '') || ':duplicate:' || duplicate_run_id::text,
      COALESCE(run_record ->> 'langsmith_run_id', '') || ':duplicate:' || duplicate_run_id::text,
      current_user_id,
      now(),
      now()
    )
    RETURNING to_jsonb(workflow_runs.*) INTO duplicate_run;

    INSERT INTO public.workflow_audit_events (
      id,
      company_id,
      actor_type,
      actor_id,
      workflow_run_id,
      workflow_item_id,
      event_type,
      summary,
      payload,
      trace
    )
    VALUES (
      gen_random_uuid(),
      target_company_id,
      'user',
      current_user_id,
      duplicate_run_id,
      existing_item_id,
      'item_duplicate_suppressed',
      'Duplicate fixture event reused the existing durable workflow trace.',
      jsonb_build_object('existingEventId', existing_event_id, 'existingItemId', existing_item_id),
      jsonb_build_object(
        'langGraphThreadId', duplicate_run ->> 'langgraph_thread_id',
        'langGraphCheckpointId', duplicate_run ->> 'langgraph_checkpoint_id',
        'langSmithTraceId', duplicate_run ->> 'langsmith_trace_id',
        'langSmithRunId', duplicate_run ->> 'langsmith_run_id'
      )
    );

    RETURN jsonb_build_object(
      'duplicate', true,
      'run', duplicate_run,
      'eventId', existing_event_id,
      'itemId', existing_item_id
    );
  END IF;

  definition_record := definition_record || jsonb_build_object(
    'created_by', current_user_id,
    'updated_by', current_user_id,
    'created_at', COALESCE(run_record ->> 'started_at', now()::text),
    'updated_at', COALESCE(run_record ->> 'started_at', now()::text)
  );

  INSERT INTO public.agent_workflows
  SELECT *
  FROM jsonb_populate_record(NULL::public.agent_workflows, definition_record)
  ON CONFLICT (company_id, workflow_key, version) DO NOTHING;

  SELECT aw.id
  INTO definition_id
  FROM public.agent_workflows aw
  WHERE aw.company_id = target_company_id
    AND aw.workflow_key = definition_record ->> 'workflow_key'
    AND aw.version = definition_record ->> 'version';

  IF definition_id IS NULL THEN
    RAISE EXCEPTION 'workflow_definition_conflict' USING ERRCODE = '23505';
  END IF;

  run_record := run_record || jsonb_build_object(
    'workflow_id', definition_id,
    'started_by', current_user_id
  );
  event_record := event_record || jsonb_build_object('workflow_id', definition_id);
  IF item_record <> 'null'::jsonb THEN
    item_record := item_record || jsonb_build_object('workflow_id', definition_id);
  END IF;

  IF item_record <> 'null'::jsonb THEN
    SELECT wi.id
    INTO existing_item_id
    FROM public.workflow_items wi
    WHERE wi.company_id = target_company_id
      AND wi.item_key = item_record ->> 'item_key'
      AND wi.status IN ('active', 'blocked', 'approved')
    LIMIT 1;
  END IF;

  IF existing_item_id IS NOT NULL THEN
    run_record := run_record || jsonb_build_object('status', 'suppressed', 'completed_at', now());
    INSERT INTO public.workflow_runs
    SELECT * FROM jsonb_populate_record(NULL::public.workflow_runs, run_record)
    RETURNING to_jsonb(workflow_runs.*) INTO inserted_run;

    INSERT INTO public.workflow_events
    SELECT * FROM jsonb_populate_record(NULL::public.workflow_events, event_record);

    INSERT INTO public.workflow_audit_events (
      id,
      company_id,
      actor_type,
      actor_id,
      workflow_run_id,
      workflow_item_id,
      event_type,
      summary,
      payload,
      trace
    )
    VALUES (
      gen_random_uuid(),
      target_company_id,
      'user',
      current_user_id,
      (run_record ->> 'id')::uuid,
      existing_item_id,
      'item_duplicate_suppressed',
      'An existing active workflow item already covers this event.',
      jsonb_build_object('existingItemId', existing_item_id, 'eventId', event_record ->> 'id'),
      jsonb_build_object(
        'langGraphThreadId', run_record ->> 'langgraph_thread_id',
        'langGraphCheckpointId', run_record ->> 'langgraph_checkpoint_id',
        'langSmithTraceId', run_record ->> 'langsmith_trace_id',
        'langSmithRunId', run_record ->> 'langsmith_run_id'
      )
    );

    RETURN jsonb_build_object(
      'duplicate', true,
      'run', inserted_run,
      'eventId', event_record ->> 'id',
      'itemId', existing_item_id
    );
  END IF;

  INSERT INTO public.workflow_runs
  SELECT * FROM jsonb_populate_record(NULL::public.workflow_runs, run_record)
  RETURNING to_jsonb(workflow_runs.*) INTO inserted_run;

  INSERT INTO public.workflow_events
  SELECT * FROM jsonb_populate_record(NULL::public.workflow_events, event_record);

  IF item_record <> 'null'::jsonb THEN
    INSERT INTO public.workflow_items
    SELECT * FROM jsonb_populate_record(NULL::public.workflow_items, item_record);
  END IF;
  IF context_record <> 'null'::jsonb THEN
    INSERT INTO public.workflow_context_packets
    SELECT * FROM jsonb_populate_record(NULL::public.workflow_context_packets, context_record);
  END IF;
  IF recommendation_record <> 'null'::jsonb THEN
    INSERT INTO public.workflow_recommendation_runs
    SELECT * FROM jsonb_populate_record(NULL::public.workflow_recommendation_runs, recommendation_record);
  END IF;
  IF evidence_record <> 'null'::jsonb THEN
    INSERT INTO public.workflow_evidence_snapshots
    SELECT * FROM jsonb_populate_record(NULL::public.workflow_evidence_snapshots, evidence_record);
  END IF;
  IF draft_record <> 'null'::jsonb THEN
    draft_record := draft_record || jsonb_build_object(
      'edit_policy',
      COALESCE(
        draft_record -> 'edit_policy',
        '{"editable":false,"requireReason":true,"immutablePaths":[["mode"]],"arrayLengthPaths":[]}'::jsonb
      )
    );
    draft_record := jsonb_set(
      draft_record,
      '{payload_hash}',
      to_jsonb(encode(extensions.digest(convert_to((draft_record -> 'payload')::text, 'UTF8'), 'sha256'), 'hex'))
    );
    INSERT INTO public.workflow_action_drafts
    SELECT * FROM jsonb_populate_record(NULL::public.workflow_action_drafts, draft_record);
  END IF;

  FOR audit_record IN SELECT value FROM jsonb_array_elements(audit_records)
  LOOP
    audit_record := audit_record || jsonb_build_object(
      'actor_type', 'user',
      'actor_id', current_user_id,
      'trace', jsonb_build_object(
        'langGraphThreadId', run_record ->> 'langgraph_thread_id',
        'langGraphCheckpointId', run_record ->> 'langgraph_checkpoint_id',
        'langSmithTraceId', run_record ->> 'langsmith_trace_id',
        'langSmithRunId', run_record ->> 'langsmith_run_id'
      )
    );
    INSERT INTO public.workflow_audit_events
    SELECT * FROM jsonb_populate_record(NULL::public.workflow_audit_events, audit_record);
  END LOOP;

  RETURN jsonb_build_object(
    'duplicate', false,
    'run', inserted_run,
    'eventId', event_record ->> 'id',
    'itemId', item_record ->> 'id',
    'draftId', draft_record ->> 'id'
  );
END;
$$;

CREATE FUNCTION workflow_private.record_workflow_decision(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL,
  p_warnings_acknowledged BOOLEAN DEFAULT false,
  p_edited_payload JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  draft_record public.workflow_action_drafts%ROWTYPE;
  item_record public.workflow_items%ROWTYPE;
  run_record public.workflow_runs%ROWTYPE;
  recommendation_record public.workflow_recommendation_runs%ROWTYPE;
  decision_record public.workflow_decisions%ROWTYPE;
  token_record public.workflow_execution_tokens%ROWTYPE;
  approved_payload JSONB;
  approved_payload_hash TEXT;
  original_payload_hash TEXT;
  raw_token TEXT;
  minimum_role TEXT := 'approver';
  require_warning_acknowledgement BOOLEAN := true;
  edit_policy JSONB;
  path_record JSONB;
  path_parts TEXT[];
  next_draft_status TEXT;
  next_item_status TEXT;
  next_run_status TEXT;
  execution_token JSONB := NULL;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approve', 'edit', 'reject', 'request_rework') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL AND length(p_reason) > 2000 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22023';
  END IF;

  SELECT draft_row.*
  INTO draft_record
  FROM public.workflow_action_drafts draft_row
  WHERE draft_row.id = p_action_draft_id
    AND draft_row.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF draft_record.status <> 'pending_review' THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '55000';
  END IF;

  SELECT item_row.* INTO STRICT item_record
  FROM public.workflow_items item_row
  WHERE item_row.id = draft_record.workflow_item_id
    AND item_row.company_id = p_company_id
  FOR UPDATE;

  SELECT run_row.* INTO STRICT run_record
  FROM public.workflow_runs run_row
  WHERE run_row.id = draft_record.workflow_run_id
    AND run_row.company_id = p_company_id
  FOR UPDATE;

  SELECT recommendation_row.* INTO STRICT recommendation_record
  FROM public.workflow_recommendation_runs recommendation_row
  WHERE recommendation_row.id = draft_record.recommendation_run_id
    AND recommendation_row.company_id = p_company_id;

  SELECT policy.minimum_role, policy.require_warning_acknowledgement
  INTO minimum_role, require_warning_acknowledgement
  FROM public.company_approval_policies policy
  WHERE policy.company_id = p_company_id
    AND policy.workflow_type = run_record.workflow_type
    AND policy.action_type = draft_record.action_type;

  minimum_role := COALESCE(minimum_role, 'approver');
  require_warning_acknowledgement := COALESCE(require_warning_acknowledgement, true);
  PERFORM workflow_private.require_company_role(p_company_id, minimum_role, current_user_id);

  IF p_decision IN ('approve', 'edit') THEN
    IF recommendation_record.status <> 'ready_for_review'
      OR recommendation_record.warning_state = 'blocked'
    THEN
      RAISE EXCEPTION 'recommendation_not_approvable' USING ERRCODE = '55000';
    END IF;
    IF require_warning_acknowledgement
      AND jsonb_typeof(recommendation_record.warnings) = 'array'
      AND jsonb_array_length(recommendation_record.warnings) > 0
      AND p_warnings_acknowledged IS NOT true
    THEN
      RAISE EXCEPTION 'warnings_not_acknowledged' USING ERRCODE = '22023';
    END IF;
  END IF;

  approved_payload := draft_record.payload;
  original_payload_hash := draft_record.payload_hash;
  edit_policy := draft_record.edit_policy;
  IF p_decision = 'edit' THEN
    IF COALESCE((edit_policy ->> 'editable')::boolean, false) IS NOT true
      OR jsonb_typeof(p_edited_payload) <> 'object'
    THEN
      RAISE EXCEPTION 'edited_payload_invalid' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((edit_policy ->> 'requireReason')::boolean, true)
      AND NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL
    THEN
      RAISE EXCEPTION 'edit_reason_required' USING ERRCODE = '22023';
    END IF;
    IF (
      SELECT array_agg(original_key ORDER BY original_key)
      FROM jsonb_object_keys(draft_record.payload) original_key
    ) IS DISTINCT FROM (
      SELECT array_agg(edited_key ORDER BY edited_key)
      FROM jsonb_object_keys(p_edited_payload) edited_key
    ) THEN
      RAISE EXCEPTION 'edited_payload_shape_changed' USING ERRCODE = '22023';
    END IF;

    FOR path_record IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(edit_policy -> 'immutablePaths', '[]'::jsonb))
    LOOP
      SELECT array_agg(path_part ORDER BY ordinality)
      INTO path_parts
      FROM jsonb_array_elements_text(path_record) WITH ORDINALITY AS parts(path_part, ordinality);
      IF draft_record.payload #> path_parts IS DISTINCT FROM p_edited_payload #> path_parts THEN
        RAISE EXCEPTION 'edited_payload_identity_changed' USING ERRCODE = '22023';
      END IF;
    END LOOP;

    FOR path_record IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(edit_policy -> 'arrayLengthPaths', '[]'::jsonb))
    LOOP
      SELECT array_agg(path_part ORDER BY ordinality)
      INTO path_parts
      FROM jsonb_array_elements_text(path_record) WITH ORDINALITY AS parts(path_part, ordinality);
      IF jsonb_typeof(draft_record.payload #> path_parts) <> 'array'
        OR jsonb_typeof(p_edited_payload #> path_parts) <> 'array'
        OR jsonb_array_length(draft_record.payload #> path_parts) <> jsonb_array_length(p_edited_payload #> path_parts)
      THEN
        RAISE EXCEPTION 'edited_payload_shape_changed' USING ERRCODE = '22023';
      END IF;
    END LOOP;

    FOR path_record IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(edit_policy -> 'positiveIntegerPaths', '[]'::jsonb))
    LOOP
      SELECT array_agg(path_part ORDER BY ordinality)
      INTO path_parts
      FROM jsonb_array_elements_text(path_record) WITH ORDINALITY AS parts(path_part, ordinality);
      IF jsonb_typeof(p_edited_payload #> path_parts) <> 'number'
        OR ((p_edited_payload #>> path_parts)::numeric <= 0)
        OR mod((p_edited_payload #>> path_parts)::numeric, 1) <> 0
      THEN
        RAISE EXCEPTION 'edited_payload_value_invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;

    FOR path_record IN
      SELECT value
      FROM jsonb_array_elements(COALESCE(edit_policy -> 'nonEmptyStringPaths', '[]'::jsonb))
    LOOP
      SELECT array_agg(path_part ORDER BY ordinality)
      INTO path_parts
      FROM jsonb_array_elements_text(path_record) WITH ORDINALITY AS parts(path_part, ordinality);
      IF jsonb_typeof(p_edited_payload #> path_parts) <> 'string'
        OR NULLIF(btrim(p_edited_payload #>> path_parts), '') IS NULL
      THEN
        RAISE EXCEPTION 'edited_payload_value_invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;

    approved_payload := p_edited_payload;
  ELSIF p_edited_payload IS NOT NULL THEN
    RAISE EXCEPTION 'edited_payload_not_allowed' USING ERRCODE = '22023';
  END IF;

  approved_payload_hash := encode(
    extensions.digest(convert_to(approved_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
  next_draft_status := CASE
    WHEN p_decision IN ('approve', 'edit') THEN 'approved'
    WHEN p_decision = 'reject' THEN 'rejected'
    ELSE 'rework_requested'
  END;
  next_item_status := CASE
    WHEN p_decision IN ('approve', 'edit') THEN 'approved'
    WHEN p_decision = 'reject' THEN 'rejected'
    ELSE 'active'
  END;
  next_run_status := CASE
    WHEN p_decision IN ('approve', 'edit') THEN 'approved'
    WHEN p_decision = 'reject' THEN 'rejected'
    ELSE 'rework_requested'
  END;

  INSERT INTO public.workflow_decisions (
    id,
    company_id,
    workflow_run_id,
    workflow_item_id,
    action_draft_id,
    decision,
    actor_type,
    decided_by,
    reason,
    warnings_acknowledged,
    edited_payload
  )
  VALUES (
    gen_random_uuid(),
    p_company_id,
    draft_record.workflow_run_id,
    draft_record.workflow_item_id,
    draft_record.id,
    p_decision,
    'user',
    current_user_id,
    p_reason,
    COALESCE(p_warnings_acknowledged, false),
    CASE WHEN p_decision = 'edit' THEN approved_payload ELSE NULL END
  )
  RETURNING * INTO decision_record;

  UPDATE public.workflow_action_drafts
  SET status = next_draft_status,
      payload = approved_payload,
      payload_hash = approved_payload_hash,
      updated_at = now()
  WHERE id = draft_record.id
    AND company_id = p_company_id
  RETURNING * INTO draft_record;

  UPDATE public.workflow_items
  SET status = next_item_status,
      resolution_state = resolution_state || jsonb_build_object(
        'lastDecision', p_decision,
        'reason', p_reason,
        'warningsAcknowledged', COALESCE(p_warnings_acknowledged, false),
        'originalPayloadHash', original_payload_hash,
        'approvedPayloadHash', approved_payload_hash
      ),
      updated_at = now()
  WHERE id = draft_record.workflow_item_id
    AND company_id = p_company_id
  RETURNING * INTO item_record;

  UPDATE public.workflow_runs
  SET status = next_run_status,
      completed_at = CASE WHEN p_decision = 'reject' THEN now() ELSE completed_at END
  WHERE id = draft_record.workflow_run_id
    AND company_id = p_company_id
  RETURNING * INTO run_record;

  IF p_decision IN ('approve', 'edit') THEN
    raw_token := encode(extensions.gen_random_bytes(32), 'hex');
    INSERT INTO public.workflow_execution_tokens (
      id,
      company_id,
      action_draft_id,
      action_type,
      token_hash,
      payload_hash,
      expires_at,
      created_by
    )
    VALUES (
      gen_random_uuid(),
      p_company_id,
      draft_record.id,
      draft_record.action_type,
      encode(extensions.digest(convert_to(raw_token, 'UTF8'), 'sha256'), 'hex'),
      approved_payload_hash,
      now() + interval '15 minutes',
      current_user_id
    )
    RETURNING * INTO token_record;

    execution_token := jsonb_build_object(
      'id', token_record.id,
      'rawToken', raw_token,
      'expiresAt', token_record.expires_at
    );
  END IF;

  INSERT INTO public.workflow_audit_events (
    id,
    company_id,
    actor_type,
    actor_id,
    workflow_run_id,
    workflow_item_id,
    event_type,
    summary,
    payload,
    trace
  )
  VALUES (
    gen_random_uuid(),
    p_company_id,
    'user',
    current_user_id,
    run_record.id,
    item_record.id,
    'decision_recorded',
    'Workflow decision recorded: ' || p_decision || '.',
    jsonb_build_object(
      'decisionId', decision_record.id,
      'actionDraftId', draft_record.id,
      'edited', p_decision = 'edit',
      'approvedPayloadHash', approved_payload_hash
    ),
    jsonb_build_object(
      'langGraphThreadId', run_record.langgraph_thread_id,
      'langGraphCheckpointId', run_record.langgraph_checkpoint_id,
      'langSmithTraceId', run_record.langsmith_trace_id,
      'langSmithRunId', run_record.langsmith_run_id
    )
  );

  RETURN jsonb_build_object(
    'decision', to_jsonb(decision_record),
    'draft', to_jsonb(draft_record),
    'item', to_jsonb(item_record),
    'executionToken', execution_token
  );
END;
$$;

CREATE FUNCTION workflow_private.execute_mock_workflow_action(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision_id UUID,
  p_raw_token TEXT,
  p_idempotency_key TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  draft_record public.workflow_action_drafts%ROWTYPE;
  item_record public.workflow_items%ROWTYPE;
  run_record public.workflow_runs%ROWTYPE;
  decision_record public.workflow_decisions%ROWTYPE;
  token_record public.workflow_execution_tokens%ROWTYPE;
  attempt_record public.workflow_action_attempts%ROWTYPE;
  minimum_role TEXT := 'approver';
  payload_hash TEXT;
  expected_token_hash TEXT;
  mock_external_id TEXT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL
    OR length(p_idempotency_key) < 8
    OR length(p_idempotency_key) > 200
    OR jsonb_typeof(p_payload) <> 'object'
  THEN
    RAISE EXCEPTION 'invalid_execution_request' USING ERRCODE = '22023';
  END IF;

  SELECT draft_row.*
  INTO draft_record
  FROM public.workflow_action_drafts draft_row
  WHERE draft_row.id = p_action_draft_id
    AND draft_row.company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT run_row.* INTO STRICT run_record
  FROM public.workflow_runs run_row
  WHERE run_row.id = draft_record.workflow_run_id
    AND run_row.company_id = p_company_id
  FOR UPDATE;

  SELECT policy.minimum_role
  INTO minimum_role
  FROM public.company_approval_policies policy
  WHERE policy.company_id = p_company_id
    AND policy.workflow_type = run_record.workflow_type
    AND policy.action_type = draft_record.action_type;

  minimum_role := COALESCE(minimum_role, 'approver');
  PERFORM workflow_private.require_company_role(p_company_id, minimum_role, current_user_id);

  SELECT attempt_row.*
  INTO attempt_record
  FROM public.workflow_action_attempts attempt_row
  WHERE attempt_row.company_id = p_company_id
    AND attempt_row.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF attempt_record.action_draft_id <> p_action_draft_id
      OR attempt_record.decision_id <> p_decision_id
      OR attempt_record.request_payload <> p_payload
    THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023';
    END IF;

    SELECT item_row.* INTO STRICT item_record
    FROM public.workflow_items item_row
    WHERE item_row.id = attempt_record.workflow_item_id
      AND item_row.company_id = p_company_id;

    INSERT INTO public.workflow_audit_events (
      id,
      company_id,
      actor_type,
      actor_id,
      workflow_run_id,
      workflow_item_id,
      event_type,
      summary,
      payload,
      trace
    )
    VALUES (
      gen_random_uuid(),
      p_company_id,
      'user',
      current_user_id,
      run_record.id,
      item_record.id,
      'mock_action_retry_suppressed',
      'Idempotent mock action retry returned the existing outcome.',
      jsonb_build_object(
        'actionAttemptId', attempt_record.id,
        'idempotencyKey', p_idempotency_key
      ),
      jsonb_build_object(
        'langGraphThreadId', run_record.langgraph_thread_id,
        'langGraphCheckpointId', run_record.langgraph_checkpoint_id,
        'langSmithTraceId', run_record.langsmith_trace_id,
        'langSmithRunId', run_record.langsmith_run_id
      )
    );

    RETURN jsonb_build_object(
      'attempt', to_jsonb(attempt_record),
      'draft', to_jsonb(draft_record),
      'item', to_jsonb(item_record),
      'duplicate', true
    );
  END IF;

  IF draft_record.status <> 'approved' THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '55000';
  END IF;

  SELECT decision_row.* INTO decision_record
  FROM public.workflow_decisions decision_row
  WHERE decision_row.id = p_decision_id
    AND decision_row.company_id = p_company_id
    AND decision_row.action_draft_id = draft_record.id
    AND decision_row.decision IN ('approve', 'edit');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decision_not_found' USING ERRCODE = 'P0002';
  END IF;

  expected_token_hash := encode(extensions.digest(convert_to(p_raw_token, 'UTF8'), 'sha256'), 'hex');
  SELECT token_row.*
  INTO token_record
  FROM public.workflow_execution_tokens token_row
  WHERE token_row.company_id = p_company_id
    AND token_row.action_draft_id = draft_record.id
    AND token_row.action_type = draft_record.action_type
    AND token_row.token_hash = expected_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF token_record.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'token_consumed' USING ERRCODE = '55000';
  END IF;
  IF token_record.expires_at <= now() THEN
    RAISE EXCEPTION 'token_expired' USING ERRCODE = '55000';
  END IF;

  payload_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  IF p_payload <> draft_record.payload
    OR payload_hash <> draft_record.payload_hash
    OR payload_hash <> token_record.payload_hash
  THEN
    RAISE EXCEPTION 'payload_hash_mismatch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.workflow_execution_tokens
  SET consumed_at = now()
  WHERE id = token_record.id
    AND company_id = p_company_id
    AND consumed_at IS NULL
    AND expires_at > now()
  RETURNING * INTO token_record;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_consumed' USING ERRCODE = '55000';
  END IF;

  mock_external_id := 'mock_action_' || substr(
    encode(
      extensions.digest(
        convert_to(p_company_id::text || ':' || draft_record.id::text || ':' || p_idempotency_key, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    1,
    20
  );

  INSERT INTO public.workflow_action_attempts (
    id,
    company_id,
    workflow_run_id,
    workflow_item_id,
    action_draft_id,
    decision_id,
    execution_token_id,
    idempotency_key,
    action_type,
    mode,
    status,
    request_payload,
    result_payload,
    mock_external_id,
    completed_at
  )
  VALUES (
    gen_random_uuid(),
    p_company_id,
    draft_record.workflow_run_id,
    draft_record.workflow_item_id,
    draft_record.id,
    decision_record.id,
    token_record.id,
    p_idempotency_key,
    draft_record.action_type,
    'mock',
    'succeeded',
    p_payload,
    jsonb_build_object('mockExternalId', mock_external_id, 'committed', false, 'mode', 'mock'),
    mock_external_id,
    now()
  )
  RETURNING * INTO attempt_record;

  UPDATE public.workflow_action_drafts
  SET status = 'executed',
      updated_at = now()
  WHERE id = draft_record.id
    AND company_id = p_company_id
  RETURNING * INTO draft_record;

  UPDATE public.workflow_items
  SET status = 'executed',
      resolution_state = resolution_state || jsonb_build_object('mockExternalId', mock_external_id),
      updated_at = now()
  WHERE id = draft_record.workflow_item_id
    AND company_id = p_company_id
  RETURNING * INTO item_record;

  UPDATE public.workflow_runs
  SET status = 'executed',
      completed_at = now()
  WHERE id = draft_record.workflow_run_id
    AND company_id = p_company_id
  RETURNING * INTO run_record;

  INSERT INTO public.workflow_audit_events (
    id,
    company_id,
    actor_type,
    actor_id,
    workflow_run_id,
    workflow_item_id,
    event_type,
    summary,
    payload,
    trace
  )
  VALUES (
    gen_random_uuid(),
    p_company_id,
    'user',
    current_user_id,
    run_record.id,
    item_record.id,
    'mock_action_executed',
    'Approved mock workflow action executed.',
    jsonb_build_object(
      'actionAttemptId', attempt_record.id,
      'mockExternalId', mock_external_id,
      'idempotencyKey', p_idempotency_key
    ),
    jsonb_build_object(
      'langGraphThreadId', run_record.langgraph_thread_id,
      'langGraphCheckpointId', run_record.langgraph_checkpoint_id,
      'langSmithTraceId', run_record.langsmith_trace_id,
      'langSmithRunId', run_record.langsmith_run_id
    )
  );

  RETURN jsonb_build_object(
    'attempt', to_jsonb(attempt_record),
    'draft', to_jsonb(draft_record),
    'item', to_jsonb(item_record),
    'duplicate', false
  );
END;
$$;

CREATE FUNCTION workflow_private.record_workflow_execution_failure(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_idempotency_key TEXT,
  p_error_code TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  draft_record public.workflow_action_drafts%ROWTYPE;
  item_record public.workflow_items%ROWTYPE;
  run_record public.workflow_runs%ROWTYPE;
  minimum_role TEXT := 'approver';
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_error_code NOT IN (
    'decision_not_found',
    'execution_failed',
    'idempotency_key_reused',
    'invalid_state',
    'payload_hash_mismatch',
    'token_consumed',
    'token_expired',
    'token_not_found'
  ) OR p_idempotency_key IS NULL OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'invalid_execution_failure' USING ERRCODE = '22023';
  END IF;

  SELECT draft_row.* INTO draft_record
  FROM public.workflow_action_drafts draft_row
  WHERE draft_row.id = p_action_draft_id
    AND draft_row.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT run_row.* INTO STRICT run_record
  FROM public.workflow_runs run_row
  WHERE run_row.id = draft_record.workflow_run_id
    AND run_row.company_id = p_company_id;

  SELECT item_row.* INTO STRICT item_record
  FROM public.workflow_items item_row
  WHERE item_row.id = draft_record.workflow_item_id
    AND item_row.company_id = p_company_id;

  SELECT policy.minimum_role INTO minimum_role
  FROM public.company_approval_policies policy
  WHERE policy.company_id = p_company_id
    AND policy.workflow_type = run_record.workflow_type
    AND policy.action_type = draft_record.action_type;

  PERFORM workflow_private.require_company_role(p_company_id, COALESCE(minimum_role, 'approver'), current_user_id);

  INSERT INTO public.workflow_audit_events (
    id,
    company_id,
    actor_type,
    actor_id,
    workflow_run_id,
    workflow_item_id,
    event_type,
    summary,
    payload,
    trace
  )
  VALUES (
    gen_random_uuid(),
    p_company_id,
    'user',
    current_user_id,
    run_record.id,
    item_record.id,
    'mock_action_execution_failed',
    'Mock workflow action execution was rejected before an external write.',
    jsonb_build_object(
      'errorCode', p_error_code,
      'idempotencyKey', p_idempotency_key
    ),
    jsonb_build_object(
      'langGraphThreadId', run_record.langgraph_thread_id,
      'langGraphCheckpointId', run_record.langgraph_checkpoint_id,
      'langSmithTraceId', run_record.langsmith_trace_id,
      'langSmithRunId', run_record.langsmith_run_id
    )
  );

  RETURN true;
END;
$$;

CREATE FUNCTION public.persist_workflow_fixture_run(p_payload JSONB)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.persist_workflow_fixture_run(p_payload)
$$;

CREATE FUNCTION public.record_workflow_execution_failure(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_idempotency_key TEXT,
  p_error_code TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.record_workflow_execution_failure(
    p_company_id,
    p_action_draft_id,
    p_idempotency_key,
    p_error_code
  )
$$;

CREATE FUNCTION public.record_workflow_decision(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL,
  p_warnings_acknowledged BOOLEAN DEFAULT false,
  p_edited_payload JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.record_workflow_decision(
    p_company_id,
    p_action_draft_id,
    p_decision,
    p_reason,
    p_warnings_acknowledged,
    p_edited_payload
  )
$$;

CREATE FUNCTION public.execute_mock_workflow_action(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision_id UUID,
  p_raw_token TEXT,
  p_idempotency_key TEXT,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.execute_mock_workflow_action(
    p_company_id,
    p_action_draft_id,
    p_decision_id,
    p_raw_token,
    p_idempotency_key,
    p_payload
  )
$$;

REVOKE ALL ON FUNCTION workflow_private.require_company_role(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.persist_workflow_fixture_run(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION workflow_private.record_workflow_decision(UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION workflow_private.execute_mock_workflow_action(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION workflow_private.record_workflow_execution_failure(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA workflow_private TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.persist_workflow_fixture_run(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.record_workflow_decision(UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.execute_mock_workflow_action(UUID, UUID, UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.record_workflow_execution_failure(UUID, UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.persist_workflow_fixture_run(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_workflow_decision(UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_mock_workflow_action(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_workflow_execution_failure(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_workflow_fixture_run(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_decision(UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_mock_workflow_action(UUID, UUID, UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_execution_failure(UUID, UUID, TEXT, TEXT) TO authenticated;
