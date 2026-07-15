-- Cycle 0.0.5: controlled agent runtime.
--
-- Platform-owned action/tool catalogs remain read-only to clients. All
-- operational records are company-owned, use composite tenant references,
-- receive RLS immediately, and are mutated through checked functions or the
-- service-role worker boundary.

CREATE TABLE public.agent_action_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key TEXT NOT NULL
    CHECK (action_key ~ '^[a-z0-9][a-z0-9._-]{1,149}$'),
  version TEXT NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+$'),
  capability_version_id UUID NOT NULL REFERENCES public.capability_definition_versions(id) ON DELETE RESTRICT,
  input_schema JSONB NOT NULL CHECK (jsonb_typeof(input_schema) = 'object'),
  output_schema JSONB NOT NULL CHECK (jsonb_typeof(output_schema) = 'object'),
  allowed_modes TEXT[] NOT NULL,
  approval_rule JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(approval_rule) = 'object'),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 900000),
  retry_class TEXT NOT NULL CHECK (retry_class IN ('never','safe','provider_idempotent','reconcile_first')),
  idempotency_scope TEXT NOT NULL CHECK (idempotency_scope IN ('request','action','workflow_item','provider')),
  audit_classification TEXT NOT NULL CHECK (audit_classification IN ('internal','confidential','restricted')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (action_key, version),
  UNIQUE (id, action_key),
  CHECK (
    cardinality(allowed_modes) BETWEEN 1 AND 5
    AND allowed_modes <@ ARRAY['fixture','mock','dry_run','shadow','live']::TEXT[]
  )
);

CREATE TABLE public.agent_tool_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_key TEXT NOT NULL CHECK (tool_key ~ '^[a-z0-9][a-z0-9._-]{1,149}$'),
  version TEXT NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+$'),
  capability_version_id UUID NOT NULL REFERENCES public.capability_definition_versions(id) ON DELETE RESTRICT,
  access_class TEXT NOT NULL CHECK (access_class IN ('read','propose','execute')),
  allowed_modes TEXT[] NOT NULL,
  input_schema JSONB NOT NULL CHECK (jsonb_typeof(input_schema) = 'object'),
  output_schema JSONB NOT NULL CHECK (jsonb_typeof(output_schema) = 'object'),
  safe_error_schema JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(safe_error_schema) = 'object'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tool_key, version),
  UNIQUE (id, tool_key),
  CHECK (
    cardinality(allowed_modes) BETWEEN 1 AND 5
    AND allowed_modes <@ ARRAY['fixture','mock','dry_run','shadow','live']::TEXT[]
  ),
  CHECK (access_class = 'execute' OR NOT ('live' = ANY(allowed_modes)))
);

ALTER TABLE public.workflow_action_attempts
  DROP CONSTRAINT workflow_action_attempts_mode_check,
  DROP CONSTRAINT workflow_action_attempts_status_check,
  ADD COLUMN action_definition_id UUID REFERENCES public.agent_action_definitions(id) ON DELETE RESTRICT,
  ADD COLUMN tool_definition_id UUID REFERENCES public.agent_tool_definitions(id) ON DELETE RESTRICT,
  ADD COLUMN attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number BETWEEN 1 AND 20),
  ADD COLUMN request_hash TEXT CHECK (request_hash IS NULL OR request_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN response_hash TEXT CHECK (response_hash IS NULL OR response_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN retry_class TEXT NOT NULL DEFAULT 'never'
    CHECK (retry_class IN ('never','safe','provider_idempotent','reconcile_first')),
  ADD COLUMN effect_state TEXT NOT NULL DEFAULT 'simulated'
    CHECK (effect_state IN ('none','simulated','observed','committed','unknown')),
  ADD COLUMN provider_idempotency_key TEXT,
  ADD COLUMN provider_reference TEXT,
  ADD COLUMN reconciliation_required BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT workflow_action_attempts_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT workflow_action_attempts_mode_check
    CHECK (mode IN ('fixture','mock','dry_run','shadow','live')),
  ADD CONSTRAINT workflow_action_attempts_status_check
    CHECK (status IN ('pending','processing','succeeded','failed','unknown','reconciliation_required')),
  ADD CONSTRAINT workflow_action_attempts_outcome_consistency CHECK (
    (status IN ('unknown','reconciliation_required') AND reconciliation_required)
    OR (status NOT IN ('unknown','reconciliation_required') AND NOT reconciliation_required)
  ),
  ADD CONSTRAINT workflow_action_attempts_live_effect_consistency CHECK (
    mode = 'live' OR effect_state <> 'committed'
  );

CREATE TABLE public.agent_execution_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  action_attempt_id UUID NOT NULL,
  receipt_sequence INTEGER NOT NULL DEFAULT 1 CHECK (receipt_sequence BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('pending','processing','succeeded','failed','unknown','reconciliation_required')),
  effect_state TEXT NOT NULL CHECK (effect_state IN ('none','simulated','observed','committed','unknown')),
  safe_output JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(safe_output) = 'object'),
  failure_class TEXT CHECK (failure_class IS NULL OR failure_class IN ('retryable','terminal','outcome_unknown','reconciliation_required')),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_hash TEXT CHECK (response_hash IS NULL OR response_hash ~ '^[a-f0-9]{64}$'),
  provider_idempotency_key TEXT,
  provider_reference TEXT,
  reconciliation_evidence JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(reconciliation_evidence) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (action_attempt_id, receipt_sequence),
  UNIQUE (id, company_id),
  FOREIGN KEY (action_attempt_id, company_id)
    REFERENCES public.workflow_action_attempts(id, company_id) ON DELETE CASCADE,
  CHECK (
    (status IN ('unknown','reconciliation_required') AND failure_class IN ('outcome_unknown','reconciliation_required'))
    OR status NOT IN ('unknown','reconciliation_required')
  ),
  CHECK (effect_state <> 'committed' OR status = 'succeeded')
);

CREATE TABLE public.agent_runtime_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL,
  lifecycle_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_state IN ('draft','ready','active','paused','disabled','invalid','archived')),
  state_version BIGINT NOT NULL DEFAULT 1 CHECK (state_version > 0),
  readiness_status TEXT NOT NULL DEFAULT 'not_checked'
    CHECK (readiness_status IN ('not_checked','checking','ready','blocked','invalidated')),
  readiness_issues JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(readiness_issues) = 'array'),
  readiness_hash TEXT CHECK (readiness_hash IS NULL OR readiness_hash ~ '^[a-f0-9]{64}$'),
  readiness_checked_at TIMESTAMPTZ,
  last_sample_run_id UUID,
  binding_snapshot_id UUID,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, workflow_id),
  UNIQUE (id, company_id),
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (last_sample_run_id, company_id)
    REFERENCES public.workflow_runs(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (binding_snapshot_id, company_id, workflow_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id, workflow_id) ON DELETE RESTRICT,
  CHECK (
    lifecycle_state NOT IN ('ready','active')
    OR (readiness_status = 'ready' AND readiness_hash IS NOT NULL AND jsonb_array_length(readiness_issues) = 0)
  )
);

CREATE TABLE public.agent_lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  runtime_state_id UUID NOT NULL,
  workflow_id UUID NOT NULL,
  transition TEXT NOT NULL CHECK (transition IN ('validate','test','activate','pause','resume','disable','rollback')),
  from_state TEXT NOT NULL CHECK (from_state IN ('draft','ready','active','paused','disabled','invalid','archived')),
  to_state TEXT NOT NULL CHECK (to_state IN ('draft','ready','active','paused','disabled','invalid','archived')),
  state_version BIGINT NOT NULL CHECK (state_version > 0),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (runtime_state_id, state_version),
  FOREIGN KEY (runtime_state_id, company_id)
    REFERENCES public.agent_runtime_states(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE CASCADE
);

CREATE TABLE public.agent_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_item_id UUID NOT NULL,
  recommendation_run_id UUID NOT NULL,
  recommendation_version TEXT NOT NULL
    CHECK (length(recommendation_version) BETWEEN 1 AND 128 AND recommendation_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  correction TEXT CHECK (correction IS NULL OR length(correction) BETWEEN 1 AND 4000),
  label TEXT CHECK (label IS NULL OR (length(label) BETWEEN 1 AND 100 AND label ~ '^[a-z0-9][a-z0-9._-]*$')),
  decision TEXT NOT NULL CHECK (decision IN ('accepted','edited','rejected','rework','rework_requested','failed','stale','unsafe')),
  structured_fields JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(structured_fields) = 'object'),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 4000),
  downstream_outcome JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(downstream_outcome) IN ('object','null')),
  client_surface TEXT NOT NULL DEFAULT 'api' CHECK (client_surface IN ('cli','web','api','automation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  FOREIGN KEY (workflow_item_id, company_id)
    REFERENCES public.workflow_items(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (recommendation_run_id, company_id)
    REFERENCES public.workflow_recommendation_runs(id, company_id) ON DELETE RESTRICT,
  CHECK (correction IS NOT NULL OR label IS NOT NULL OR reason IS NOT NULL OR downstream_outcome <> '{}'::JSONB)
);

CREATE TABLE public.agent_memory_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  feedback_id UUID,
  workflow_id UUID,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('correction_pattern','outcome_signal','preference','operating_constraint')),
  content JSONB NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  provenance JSONB NOT NULL CHECK (jsonb_typeof(provenance) = 'object' AND provenance <> '{}'::JSONB),
  scope JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(scope) = 'object'),
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected','superseded','expired','revoked','forgotten')),
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  review_reason TEXT CHECK (review_reason IS NULL OR length(review_reason) BETWEEN 1 AND 1000),
  superseded_by UUID,
  expires_at TIMESTAMPTZ,
  retention_until TIMESTAMPTZ,
  provider_key TEXT CHECK (provider_key IS NULL OR provider_key ~ '^[a-z0-9][a-z0-9._-]{1,99}$'),
  provider_reference TEXT CHECK (provider_reference IS NULL OR length(provider_reference) <= 500),
  revoked_at TIMESTAMPTZ,
  forgotten_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  FOREIGN KEY (feedback_id, company_id)
    REFERENCES public.agent_feedback(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (superseded_by, company_id)
    REFERENCES public.agent_memory_candidates(id, company_id) ON DELETE RESTRICT,
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (retention_until IS NULL OR retention_until > created_at),
  CHECK (
    (status = 'pending_review' AND reviewer_id IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending_review' AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CHECK ((status = 'superseded') = (superseded_by IS NOT NULL)),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK ((status = 'forgotten') = (forgotten_at IS NOT NULL))
);

CREATE TABLE public.agent_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL,
  workflow_run_id UUID,
  workflow_item_id UUID,
  action_attempt_id UUID,
  condition_type TEXT NOT NULL CHECK (condition_type IN ('failed','overdue','stale','unresolved')),
  due_at TIMESTAMPTZ NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','active','resolved','suppressed','dead_letter')),
  rule_version TEXT NOT NULL CHECK (rule_version ~ '^\d+\.\d+\.\d+$'),
  last_evaluated_at TIMESTAMPTZ,
  resolution JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(resolution) = 'object'),
  suppression JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(suppression) = 'object'),
  lease_id UUID,
  lease_owner TEXT CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128),
  leased_until TIMESTAMPTZ,
  recurrence_policy TEXT NOT NULL DEFAULT 'reopen' CHECK (recurrence_policy IN ('reopen','new_occurrence')),
  occurrence INTEGER NOT NULL DEFAULT 1 CHECK (occurrence > 0),
  condition JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(condition) = 'object'),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (id, company_id),
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_run_id, company_id)
    REFERENCES public.workflow_runs(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_item_id, company_id)
    REFERENCES public.workflow_items(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (action_attempt_id, company_id)
    REFERENCES public.workflow_action_attempts(id, company_id) ON DELETE RESTRICT,
  CHECK (workflow_run_id IS NOT NULL OR workflow_item_id IS NOT NULL OR action_attempt_id IS NOT NULL),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  CHECK ((lease_owner IS NULL) = (leased_until IS NULL) AND (lease_owner IS NULL) = (lease_id IS NULL))
);

CREATE TABLE public.agent_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  follow_up_id UUID NOT NULL,
  workflow_item_id UUID,
  active_key TEXT NOT NULL CHECK (length(active_key) BETWEEN 1 AND 512),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','suppressed')),
  occurrence INTEGER NOT NULL DEFAULT 1 CHECK (occurrence > 0),
  resolution JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(resolution) = 'object'),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  FOREIGN KEY (follow_up_id, company_id)
    REFERENCES public.agent_follow_ups(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_item_id, company_id)
    REFERENCES public.workflow_items(id, company_id) ON DELETE CASCADE,
  CHECK ((status = 'active' AND closed_at IS NULL) OR (status <> 'active' AND closed_at IS NOT NULL))
);

CREATE TABLE public.agent_monitoring_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  follow_up_id UUID NOT NULL,
  escalation_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'scheduled','deduplicated','claimed','retry_scheduled','escalated',
    'resolved','suppressed','dead_letter','reopened','new_occurrence'
  )),
  occurrence INTEGER NOT NULL CHECK (occurrence > 0),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','worker','system')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 128),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 2000),
  details JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 16384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  FOREIGN KEY (follow_up_id, company_id)
    REFERENCES public.agent_follow_ups(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (escalation_id, company_id)
    REFERENCES public.agent_escalations(id, company_id) ON DELETE CASCADE,
  CHECK (
    (actor_type = 'user' AND actor_id IS NOT NULL AND worker_id IS NULL)
    OR (actor_type = 'worker' AND actor_id IS NULL AND worker_id IS NOT NULL)
    OR (actor_type = 'system' AND actor_id IS NULL AND worker_id IS NULL)
  )
);

CREATE TABLE public.agent_evaluation_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  case_key TEXT NOT NULL CHECK (case_key ~ '^[a-z0-9][a-z0-9._-]{1,149}$'),
  version TEXT NOT NULL CHECK (version ~ '^\d+\.\d+\.\d+$'),
  fixture JSONB NOT NULL CHECK (jsonb_typeof(fixture) = 'object'),
  input_digest TEXT NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest TEXT CHECK (evidence_digest IS NULL OR evidence_digest ~ '^[a-f0-9]{64}$'),
  missing_data_state TEXT NOT NULL CHECK (missing_data_state IN ('complete','partial','unavailable')),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, case_key, version),
  UNIQUE (id, company_id)
);

CREATE TABLE public.agent_evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evaluation_case_id UUID NOT NULL,
  workflow_id UUID NOT NULL,
  workflow_run_id UUID,
  recommendation_run_id UUID,
  recommendation_version TEXT,
  manifest_digest TEXT NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  dataset_digest TEXT NOT NULL CHECK (dataset_digest ~ '^[a-f0-9]{64}$'),
  evaluator_version TEXT NOT NULL CHECK (evaluator_version ~ '^\d+\.\d+\.\d+$'),
  confidence_definition_version TEXT NOT NULL CHECK (confidence_definition_version ~ '^\d+\.\d+\.\d+$'),
  model_version TEXT,
  safe_trace_ids JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(safe_trace_ids) = 'array'),
  metrics JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metrics) = 'object'),
  missing_data JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(missing_data) = 'array'),
  threshold_decision TEXT NOT NULL CHECK (threshold_decision IN ('pass','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  FOREIGN KEY (evaluation_case_id, company_id)
    REFERENCES public.agent_evaluation_cases(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_run_id, company_id)
    REFERENCES public.workflow_runs(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (recommendation_run_id, company_id)
    REFERENCES public.workflow_recommendation_runs(id, company_id) ON DELETE RESTRICT,
  CHECK (
    recommendation_version IS NULL
    OR (
      length(recommendation_version) BETWEEN 1 AND 128
      AND recommendation_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  )
);

CREATE TABLE public.agent_evaluation_outcome_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  evaluation_run_id UUID,
  workflow_run_id UUID,
  recommendation_run_id UUID,
  recommendation_version TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted','edited','rejected','rework_requested','failed','stale','unsafe')),
  labelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (evaluation_run_id),
  UNIQUE (company_id, recommendation_run_id, recommendation_version),
  UNIQUE (id, company_id),
  FOREIGN KEY (evaluation_run_id, company_id)
    REFERENCES public.agent_evaluation_runs(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_run_id, company_id)
    REFERENCES public.workflow_runs(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (recommendation_run_id, company_id)
    REFERENCES public.workflow_recommendation_runs(id, company_id) ON DELETE RESTRICT,
  CHECK (
    recommendation_version IS NULL
    OR (
      length(recommendation_version) BETWEEN 1 AND 128
      AND recommendation_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  )
);

CREATE TABLE public.agent_promotion_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL,
  workflow_version TEXT NOT NULL CHECK (workflow_version ~ '^\d+\.\d+\.\d+$'),
  evaluation_run_id UUID NOT NULL,
  thresholds JSONB NOT NULL CHECK (jsonb_typeof(thresholds) = 'object'),
  decision TEXT NOT NULL CHECK (decision IN ('pass','blocked')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, workflow_id, workflow_version, evaluation_run_id),
  UNIQUE (id, company_id),
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (evaluation_run_id, company_id)
    REFERENCES public.agent_evaluation_runs(id, company_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX agent_memory_candidates_one_current_provider_ref_idx
  ON public.agent_memory_candidates(company_id, provider_key, provider_reference)
  WHERE status = 'approved' AND provider_key IS NOT NULL AND provider_reference IS NOT NULL;
CREATE INDEX agent_memory_candidates_retrieval_idx
  ON public.agent_memory_candidates(company_id, workflow_id, memory_type, confidence DESC, created_at DESC)
  WHERE status = 'approved';
CREATE INDEX agent_follow_ups_claim_idx
  ON public.agent_follow_ups(status, available_at, due_at)
  WHERE status IN ('scheduled','active');
CREATE UNIQUE INDEX agent_follow_ups_one_open_condition_idx
  ON public.agent_follow_ups(company_id, workflow_id, condition_type, rule_version,
    COALESCE(workflow_item_id, '00000000-0000-0000-0000-000000000000'::UUID),
    COALESCE(action_attempt_id, '00000000-0000-0000-0000-000000000000'::UUID))
  WHERE status IN ('scheduled','active');
CREATE UNIQUE INDEX agent_escalations_one_active_idx
  ON public.agent_escalations(company_id, active_key)
  WHERE status = 'active';
CREATE INDEX agent_monitoring_events_follow_up_idx
  ON public.agent_monitoring_events(company_id, follow_up_id, event_sequence);
CREATE INDEX agent_monitoring_events_escalation_idx
  ON public.agent_monitoring_events(company_id, escalation_id, created_at, id)
  WHERE escalation_id IS NOT NULL;
CREATE INDEX agent_evaluation_runs_workflow_idx
  ON public.agent_evaluation_runs(company_id, workflow_id, created_at DESC);

CREATE TRIGGER agent_runtime_states_touch BEFORE UPDATE ON public.agent_runtime_states
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER agent_memory_candidates_touch BEFORE UPDATE ON public.agent_memory_candidates
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER agent_follow_ups_touch BEFORE UPDATE ON public.agent_follow_ups
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER agent_escalations_touch BEFORE UPDATE ON public.agent_escalations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.agent_action_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_execution_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runtime_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_monitoring_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_evaluation_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_evaluation_outcome_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_promotion_checkpoints ENABLE ROW LEVEL SECURITY;

-- Keep the shared membership helper safe when it is called from functions that
-- deliberately clear search_path. Qualifying every referenced object also
-- prevents an attacker-controlled schema from shadowing the membership table.
CREATE OR REPLACE FUNCTION public.has_company_role(target_company_id UUID, minimum_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.company_memberships AS membership
    WHERE membership.company_id = target_company_id
      AND membership.user_id = (SELECT auth.uid())
      AND membership.status = 'active'
      AND public.company_role_rank(membership.role) >= public.company_role_rank(minimum_role)
  )
$$;

CREATE POLICY agent_action_definitions_authenticated_select
  ON public.agent_action_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY agent_tool_definitions_authenticated_select
  ON public.agent_tool_definitions FOR SELECT TO authenticated USING (true);
CREATE POLICY agent_runtime_states_member_select
  ON public.agent_runtime_states FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_lifecycle_events_member_select
  ON public.agent_lifecycle_events FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_follow_ups_member_select
  ON public.agent_follow_ups FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_escalations_member_select
  ON public.agent_escalations FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_monitoring_events_member_select
  ON public.agent_monitoring_events FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_evaluation_cases_member_select
  ON public.agent_evaluation_cases FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_evaluation_runs_member_select
  ON public.agent_evaluation_runs FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_evaluation_outcome_labels_member_select
  ON public.agent_evaluation_outcome_labels FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_promotion_checkpoints_member_select
  ON public.agent_promotion_checkpoints FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

REVOKE ALL ON TABLE
  public.agent_action_definitions,
  public.agent_tool_definitions,
  public.agent_execution_receipts,
  public.agent_runtime_states,
  public.agent_lifecycle_events,
  public.agent_feedback,
  public.agent_memory_candidates,
  public.agent_follow_ups,
  public.agent_escalations,
  public.agent_monitoring_events,
  public.agent_evaluation_cases,
  public.agent_evaluation_runs,
  public.agent_evaluation_outcome_labels,
  public.agent_promotion_checkpoints
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.agent_action_definitions,
  public.agent_tool_definitions,
  public.agent_runtime_states,
  public.agent_lifecycle_events,
  public.agent_follow_ups,
  public.agent_escalations,
  public.agent_monitoring_events,
  public.agent_evaluation_cases,
  public.agent_evaluation_runs,
  public.agent_evaluation_outcome_labels,
  public.agent_promotion_checkpoints
TO authenticated;

GRANT ALL ON TABLE
  public.agent_action_definitions,
  public.agent_tool_definitions,
  public.agent_execution_receipts,
  public.agent_runtime_states,
  public.agent_lifecycle_events,
  public.agent_feedback,
  public.agent_memory_candidates,
  public.agent_follow_ups,
  public.agent_escalations,
  public.agent_monitoring_events,
  public.agent_evaluation_cases,
  public.agent_evaluation_runs,
  public.agent_evaluation_outcome_labels,
  public.agent_promotion_checkpoints
TO service_role;

-- Worker functions remain outside the exposed public schema. The service role
-- needs schema usage to resolve the narrowly granted claim functions.
GRANT USAGE ON SCHEMA workflow_private TO service_role;

CREATE FUNCTION workflow_private.reject_agent_runtime_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'agent_runtime_history_immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER agent_execution_receipts_immutable
BEFORE UPDATE OR DELETE ON public.agent_execution_receipts
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_agent_runtime_history_mutation();
CREATE TRIGGER agent_lifecycle_events_immutable
BEFORE UPDATE OR DELETE ON public.agent_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_agent_runtime_history_mutation();
CREATE TRIGGER agent_monitoring_events_immutable
BEFORE UPDATE OR DELETE ON public.agent_monitoring_events
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_agent_runtime_history_mutation();
CREATE TRIGGER agent_evaluation_cases_immutable
BEFORE UPDATE OR DELETE ON public.agent_evaluation_cases
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_agent_runtime_history_mutation();
CREATE TRIGGER agent_evaluation_runs_immutable
BEFORE UPDATE OR DELETE ON public.agent_evaluation_runs
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_agent_runtime_history_mutation();
CREATE TRIGGER agent_evaluation_outcome_labels_immutable
BEFORE UPDATE OR DELETE ON public.agent_evaluation_outcome_labels
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_agent_runtime_history_mutation();

CREATE FUNCTION workflow_private.require_service_role()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.jwt() ->> 'role'), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION workflow_private.record_agent_readiness(
  p_company_id UUID,
  p_workflow_id UUID,
  p_expected_version BIGINT,
  p_readiness_hash TEXT,
  p_issues JSONB DEFAULT '[]'::JSONB,
  p_sample_run_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'Readiness evaluated.'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  target public.agent_runtime_states%ROWTYPE;
  next_state TEXT;
  prior_state TEXT;
  target_binding_snapshot_id UUID;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', actor);
  IF p_readiness_hash !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(COALESCE(p_issues, 'null'::JSONB)) <> 'array'
    OR jsonb_array_length(p_issues) > 100
    OR length(COALESCE(p_reason, '')) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid_readiness_result' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_workflows workflow
    WHERE workflow.id = p_workflow_id AND workflow.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.agent_runtime_states(company_id, workflow_id, updated_by)
  VALUES (p_company_id, p_workflow_id, actor)
  ON CONFLICT (company_id, workflow_id) DO NOTHING;

  SELECT state.* INTO target
  FROM public.agent_runtime_states state
  WHERE state.company_id = p_company_id AND state.workflow_id = p_workflow_id
  FOR UPDATE;
  IF target.state_version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_agent_state' USING ERRCODE = '40001';
  END IF;
  IF target.lifecycle_state IN ('active','disabled','archived') THEN
    RAISE EXCEPTION 'readiness_transition_not_allowed' USING ERRCODE = '55000';
  END IF;

  SELECT snapshot.id INTO target_binding_snapshot_id
  FROM public.workflow_binding_snapshots snapshot
  WHERE snapshot.company_id=p_company_id AND snapshot.workflow_id=p_workflow_id
    AND NOT EXISTS (
      SELECT 1 FROM public.workflow_binding_snapshot_events event
      WHERE event.company_id=p_company_id AND event.binding_snapshot_id=snapshot.id
        AND event.event_type='invalidated'
    )
  ORDER BY snapshot.created_at DESC,snapshot.id DESC LIMIT 1;
  IF target_binding_snapshot_id IS NULL AND jsonb_array_length(p_issues)=0 THEN
    RAISE EXCEPTION 'binding_snapshot_not_ready' USING ERRCODE='55000';
  END IF;

  prior_state := target.lifecycle_state;
  next_state := CASE
    WHEN target.lifecycle_state='paused' THEN 'paused'
    WHEN jsonb_array_length(p_issues) = 0 THEN 'ready'
    ELSE 'invalid'
  END;
  UPDATE public.agent_runtime_states
  SET lifecycle_state = next_state,
      state_version = state_version + 1,
      readiness_status = CASE WHEN jsonb_array_length(p_issues)=0 THEN 'ready' ELSE 'blocked' END,
      readiness_issues = p_issues,
      readiness_hash = p_readiness_hash,
      readiness_checked_at = clock_timestamp(),
      last_sample_run_id = p_sample_run_id,
      binding_snapshot_id = target_binding_snapshot_id,
      updated_by = actor
  WHERE id = target.id
  RETURNING * INTO target;

  INSERT INTO public.agent_lifecycle_events(
    company_id, runtime_state_id, workflow_id, transition, from_state, to_state,
    state_version, reason, actor_id
  ) VALUES (
    p_company_id, target.id, p_workflow_id, 'validate',
    prior_state,
    next_state, target.state_version, p_reason, actor
  );
  RETURN jsonb_build_object(
    'runtimeStateId', target.id, 'workflowId', p_workflow_id,
    'lifecycleState', target.lifecycle_state, 'readinessStatus', target.readiness_status,
    'readinessIssues', target.readiness_issues, 'stateVersion', target.state_version
  );
END;
$$;

CREATE FUNCTION workflow_private.transition_agent_lifecycle(
  p_company_id UUID,
  p_workflow_id UUID,
  p_transition TEXT,
  p_expected_version BIGINT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  target public.agent_runtime_states%ROWTYPE;
  target_workflow public.agent_workflows%ROWTYPE;
  current_activation public.workflow_activations%ROWTYPE;
  next_state TEXT;
  prior_state TEXT;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', actor);
  IF p_transition NOT IN ('test','activate','pause','resume','disable','rollback')
    OR length(COALESCE(p_reason, '')) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid_lifecycle_transition' USING ERRCODE = '22023';
  END IF;

  SELECT workflow.* INTO target_workflow
  FROM public.agent_workflows workflow
  WHERE workflow.id = p_workflow_id AND workflow.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT state.* INTO target
  FROM public.agent_runtime_states state
  WHERE state.company_id = p_company_id AND state.workflow_id = p_workflow_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_state_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF target.state_version <> p_expected_version THEN
    RAISE EXCEPTION 'stale_agent_state' USING ERRCODE = '40001';
  END IF;

  prior_state := target.lifecycle_state;
  next_state := CASE
    WHEN p_transition = 'test' AND target.lifecycle_state IN ('draft','ready','invalid') THEN target.lifecycle_state
    WHEN p_transition = 'activate' AND target.lifecycle_state = 'ready' THEN 'active'
    WHEN p_transition = 'pause' AND target.lifecycle_state = 'active' THEN 'paused'
    WHEN p_transition = 'resume' AND target.lifecycle_state = 'paused' THEN 'active'
    WHEN p_transition = 'disable' AND target.lifecycle_state IN ('draft','ready','active','paused','invalid') THEN 'disabled'
    WHEN p_transition = 'rollback' AND target.lifecycle_state IN ('active','paused','disabled','invalid') THEN 'ready'
    ELSE NULL
  END;
  IF next_state IS NULL THEN
    RAISE EXCEPTION 'lifecycle_transition_not_allowed' USING ERRCODE = '55000';
  END IF;
  IF next_state IN ('ready','active') AND (
    target.readiness_status <> 'ready'
    OR target.readiness_hash IS NULL
    OR jsonb_array_length(target.readiness_issues) <> 0
  ) THEN
    RAISE EXCEPTION 'agent_not_ready' USING ERRCODE = '55000';
  END IF;
  IF p_transition='resume' AND target.state_version <= COALESCE((
    SELECT max(event.state_version) FROM public.agent_lifecycle_events event
    WHERE event.company_id=p_company_id AND event.workflow_id=p_workflow_id
      AND event.transition='pause'
  ),0) THEN
    RAISE EXCEPTION 'agent_readiness_stale' USING ERRCODE='55000';
  END IF;
  IF next_state = 'active' AND EXISTS (
    SELECT 1 FROM public.agent_promotion_checkpoints checkpoint
    WHERE checkpoint.company_id = p_company_id
      AND checkpoint.workflow_id = p_workflow_id
      AND checkpoint.workflow_version = target_workflow.version
      AND checkpoint.decision = 'blocked'
  ) THEN
    RAISE EXCEPTION 'promotion_checkpoint_blocked' USING ERRCODE = '55000';
  END IF;
  IF next_state='active' AND (
    target.binding_snapshot_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.workflow_binding_snapshots snapshot
      WHERE snapshot.id=target.binding_snapshot_id AND snapshot.company_id=p_company_id
        AND snapshot.workflow_id=p_workflow_id
        AND NOT EXISTS (
          SELECT 1 FROM public.workflow_binding_snapshot_events event
          WHERE event.company_id=p_company_id AND event.binding_snapshot_id=snapshot.id
            AND event.event_type='invalidated'
        )
    )
  ) THEN
    RAISE EXCEPTION 'binding_snapshot_not_ready' USING ERRCODE='55000';
  END IF;

  SELECT activation.* INTO current_activation
  FROM public.workflow_activations activation
  WHERE activation.company_id=p_company_id AND activation.workflow_key=target_workflow.workflow_key
  FOR UPDATE;

  UPDATE public.agent_runtime_states
  SET lifecycle_state = next_state,
      state_version = state_version + 1,
      updated_by = actor
  WHERE id = target.id
  RETURNING * INTO target;

  IF next_state='active' THEN
    INSERT INTO public.workflow_activations(
      company_id,workflow_key,workflow_id,binding_snapshot_id,activation_sequence,activated_by,activated_at
    ) VALUES (
      p_company_id,target_workflow.workflow_key,p_workflow_id,target.binding_snapshot_id,
      target.state_version,actor,now()
    ) ON CONFLICT (company_id,workflow_key) DO UPDATE SET
      workflow_id=EXCLUDED.workflow_id,binding_snapshot_id=EXCLUDED.binding_snapshot_id,
      activation_sequence=EXCLUDED.activation_sequence,activated_by=EXCLUDED.activated_by,
      activated_at=EXCLUDED.activated_at;
    INSERT INTO public.workflow_activation_events(
      company_id,workflow_key,workflow_id,binding_snapshot_id,previous_workflow_id,event_type,actor_id
    ) VALUES (
      p_company_id,target_workflow.workflow_key,p_workflow_id,target.binding_snapshot_id,
      current_activation.workflow_id,'activated',actor
    );
  ELSIF prior_state IN ('active','paused') AND next_state<>'active' AND current_activation.workflow_id IS NOT NULL THEN
    DELETE FROM public.workflow_activations activation
    WHERE activation.company_id=p_company_id AND activation.workflow_key=target_workflow.workflow_key;
    INSERT INTO public.workflow_activation_events(
      company_id,workflow_key,workflow_id,binding_snapshot_id,previous_workflow_id,event_type,actor_id
    ) VALUES (
      p_company_id,target_workflow.workflow_key,p_workflow_id,target.binding_snapshot_id,
      current_activation.workflow_id,'deactivated',actor
    );
  END IF;

  IF p_transition IN ('pause','disable') THEN
    UPDATE public.workflow_resume_outbox outbox
    SET status = 'failed', leased_until = NULL,
        checkpoint = outbox.checkpoint || jsonb_build_object(
          'blockedByLifecycle', next_state,
          'blockedAt', now(),
          'reason', p_reason
        )
    WHERE outbox.company_id = p_company_id
      AND outbox.workflow_run_id IN (
        SELECT run.id FROM public.workflow_runs run
        WHERE run.company_id = p_company_id AND run.workflow_id = p_workflow_id
      )
      AND outbox.status IN ('pending','processing');
  END IF;

  INSERT INTO public.agent_lifecycle_events(
    company_id, runtime_state_id, workflow_id, transition, from_state, to_state,
    state_version, reason, actor_id
  ) VALUES (
    p_company_id, target.id, p_workflow_id, p_transition,
    prior_state,
    target.lifecycle_state, target.state_version, p_reason, actor
  );
  RETURN jsonb_build_object(
    'runtimeStateId', target.id, 'workflowId', p_workflow_id,
    'lifecycleState', target.lifecycle_state, 'transition', p_transition,
    'stateVersion', target.state_version
  );
END;
$$;

CREATE FUNCTION public.record_agent_readiness_v1(
  p_company_id UUID,
  p_workflow_id UUID,
  p_expected_version BIGINT,
  p_readiness_hash TEXT,
  p_issues JSONB DEFAULT '[]'::JSONB,
  p_sample_run_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'Readiness evaluated.'
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.record_agent_readiness(
    p_company_id, p_workflow_id, p_expected_version, p_readiness_hash,
    p_issues, p_sample_run_id, p_reason
  )
$$;

CREATE FUNCTION public.transition_agent_lifecycle_v1(
  p_company_id UUID,
  p_workflow_id UUID,
  p_transition TEXT,
  p_expected_version BIGINT,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.transition_agent_lifecycle(
    p_company_id, p_workflow_id, p_transition, p_expected_version, p_reason
  )
$$;

CREATE FUNCTION workflow_private.block_inactive_agent_resume_work()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('pending','processing') AND EXISTS (
    SELECT 1
    FROM public.workflow_runs run
    JOIN public.agent_runtime_states state
      ON state.company_id = run.company_id AND state.workflow_id = run.workflow_id
    WHERE run.id = NEW.workflow_run_id AND run.company_id = NEW.company_id
      AND state.lifecycle_state <> 'active'
  ) THEN
    RAISE EXCEPTION 'agent_lifecycle_blocks_queued_work' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_resume_outbox_agent_lifecycle_guard
BEFORE INSERT OR UPDATE OF status, workflow_run_id ON public.workflow_resume_outbox
FOR EACH ROW EXECUTE FUNCTION workflow_private.block_inactive_agent_resume_work();

CREATE FUNCTION workflow_private.record_agent_feedback(
  p_company_id UUID,
  p_workflow_item_id UUID,
  p_recommendation_run_id UUID,
  p_outcome TEXT,
  p_correction TEXT DEFAULT NULL,
  p_label TEXT DEFAULT NULL,
  p_structured_fields JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT NULL,
  p_downstream_outcome JSONB DEFAULT '{}'::JSONB,
  p_memory_suggestion JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  feedback_id UUID;
  memory_id UUID;
  workflow_id_value UUID;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', actor);
  IF p_outcome NOT IN ('accepted','edited','rejected','rework_requested','failed','stale','unsafe')
    OR jsonb_typeof(COALESCE(p_structured_fields, 'null'::JSONB)) <> 'object'
    OR jsonb_typeof(COALESCE(p_downstream_outcome, 'null'::JSONB)) <> 'object'
    OR pg_column_size(p_structured_fields) > 65536
    OR pg_column_size(p_downstream_outcome) > 65536
  THEN
    RAISE EXCEPTION 'invalid_agent_feedback' USING ERRCODE = '22023';
  END IF;
  SELECT item.workflow_id INTO workflow_id_value
  FROM public.workflow_items item
  JOIN public.workflow_recommendation_runs recommendation
    ON recommendation.id = p_recommendation_run_id
   AND recommendation.company_id = item.company_id
   AND recommendation.workflow_item_id = item.id
  WHERE item.id = p_workflow_item_id AND item.company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'feedback_source_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.agent_feedback(
    company_id, workflow_item_id, recommendation_run_id, actor_id, correction,
    label, outcome, structured_fields, reason, downstream_outcome
  ) VALUES (
    p_company_id, p_workflow_item_id, p_recommendation_run_id, actor,
    p_correction, p_label, p_outcome, p_structured_fields, p_reason,
    p_downstream_outcome
  ) RETURNING id INTO feedback_id;

  IF p_memory_suggestion IS NOT NULL THEN
    IF jsonb_typeof(p_memory_suggestion) <> 'object'
      OR p_memory_suggestion - ARRAY['type','content','provenance','scope','confidence','expiresAt','retentionUntil'] <> '{}'::JSONB
      OR NOT (p_memory_suggestion ?& ARRAY['type','content','provenance','confidence'])
      OR jsonb_typeof(p_memory_suggestion -> 'content') <> 'object'
      OR jsonb_typeof(p_memory_suggestion -> 'provenance') <> 'object'
      OR COALESCE(jsonb_typeof(p_memory_suggestion -> 'scope'), 'object') <> 'object'
      OR (p_memory_suggestion ->> 'type') NOT IN ('preference','correction','outcome','procedure','exception')
      OR (p_memory_suggestion ->> 'confidence')::NUMERIC NOT BETWEEN 0 AND 1
      OR pg_column_size(p_memory_suggestion) > 131072
    THEN
      RAISE EXCEPTION 'invalid_memory_suggestion' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.agent_memory_candidates(
      company_id, feedback_id, workflow_id, memory_type, content, provenance,
      scope, confidence, expires_at, retention_until
    ) VALUES (
      p_company_id, feedback_id, workflow_id_value, p_memory_suggestion ->> 'type',
      p_memory_suggestion -> 'content', p_memory_suggestion -> 'provenance',
      COALESCE(p_memory_suggestion -> 'scope', '{}'::JSONB),
      (p_memory_suggestion ->> 'confidence')::NUMERIC,
      (p_memory_suggestion ->> 'expiresAt')::TIMESTAMPTZ,
      (p_memory_suggestion ->> 'retentionUntil')::TIMESTAMPTZ
    ) RETURNING id INTO memory_id;
  END IF;

  RETURN jsonb_build_object(
    'feedbackId', feedback_id,
    'memoryCandidateId', memory_id,
    'memoryStatus', CASE WHEN memory_id IS NULL THEN NULL ELSE 'pending_review' END
  );
END;
$$;

CREATE FUNCTION public.record_agent_feedback_v1(
  p_company_id UUID,
  p_workflow_item_id UUID,
  p_recommendation_run_id UUID,
  p_outcome TEXT,
  p_correction TEXT DEFAULT NULL,
  p_label TEXT DEFAULT NULL,
  p_structured_fields JSONB DEFAULT '{}'::JSONB,
  p_reason TEXT DEFAULT NULL,
  p_downstream_outcome JSONB DEFAULT '{}'::JSONB,
  p_memory_suggestion JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.record_agent_feedback(
    p_company_id, p_workflow_item_id, p_recommendation_run_id, p_outcome,
    p_correction, p_label, p_structured_fields, p_reason,
    p_downstream_outcome, p_memory_suggestion
  )
$$;

CREATE FUNCTION workflow_private.review_agent_memory_candidate(
  p_company_id UUID,
  p_candidate_id UUID,
  p_expected_status TEXT,
  p_decision TEXT,
  p_reason TEXT,
  p_superseded_by UUID DEFAULT NULL,
  p_provider_key TEXT DEFAULT NULL,
  p_provider_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  candidate public.agent_memory_candidates%ROWTYPE;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', actor);
  IF p_decision NOT IN ('approved','rejected','superseded','expired','revoked','forgotten')
    OR length(COALESCE(p_reason, '')) NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid_memory_review' USING ERRCODE = '22023';
  END IF;
  SELECT row.* INTO candidate
  FROM public.agent_memory_candidates row
  WHERE row.id = p_candidate_id AND row.company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'memory_candidate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF candidate.status <> p_expected_status THEN
    RAISE EXCEPTION 'stale_memory_candidate' USING ERRCODE = '40001';
  END IF;
  IF (candidate.status = 'pending_review' AND p_decision NOT IN ('approved','rejected'))
    OR (candidate.status = 'approved' AND p_decision NOT IN ('superseded','expired','revoked','forgotten'))
    OR (candidate.status NOT IN ('pending_review','approved'))
  THEN
    RAISE EXCEPTION 'memory_review_transition_not_allowed' USING ERRCODE = '55000';
  END IF;
  IF (p_decision = 'superseded') <> (p_superseded_by IS NOT NULL) THEN
    RAISE EXCEPTION 'memory_supersession_target_required' USING ERRCODE = '22023';
  END IF;
  IF p_decision = 'approved' AND ((p_provider_key IS NULL) <> (p_provider_reference IS NULL)) THEN
    RAISE EXCEPTION 'memory_provider_reference_incomplete' USING ERRCODE = '22023';
  END IF;
  IF p_superseded_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_memory_candidates successor
    WHERE successor.id = p_superseded_by AND successor.company_id = p_company_id
      AND successor.status = 'approved' AND successor.id <> p_candidate_id
  ) THEN
    RAISE EXCEPTION 'memory_supersession_target_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.agent_memory_candidates
  SET status = p_decision,
      reviewer_id = actor,
      reviewed_at = now(),
      review_reason = p_reason,
      superseded_by = p_superseded_by,
      provider_key = CASE WHEN p_decision = 'approved' THEN p_provider_key ELSE provider_key END,
      provider_reference = CASE WHEN p_decision = 'approved' THEN p_provider_reference ELSE provider_reference END,
      revoked_at = CASE WHEN p_decision = 'revoked' THEN now() ELSE NULL END,
      forgotten_at = CASE WHEN p_decision = 'forgotten' THEN now() ELSE NULL END,
      content = CASE WHEN p_decision = 'forgotten' THEN '{}'::JSONB ELSE content END
  WHERE id = p_candidate_id
  RETURNING * INTO candidate;

  RETURN jsonb_build_object(
    'candidateId', candidate.id, 'status', candidate.status,
    'reviewedAt', candidate.reviewed_at, 'supersededBy', candidate.superseded_by
  );
END;
$$;

CREATE FUNCTION public.review_agent_memory_candidate_v1(
  p_company_id UUID,
  p_candidate_id UUID,
  p_expected_status TEXT,
  p_decision TEXT,
  p_reason TEXT,
  p_superseded_by UUID DEFAULT NULL,
  p_provider_key TEXT DEFAULT NULL,
  p_provider_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.review_agent_memory_candidate(
    p_company_id, p_candidate_id, p_expected_status, p_decision, p_reason,
    p_superseded_by, p_provider_key, p_provider_reference
  )
$$;

CREATE FUNCTION workflow_private.retrieve_agent_memory(
  p_company_id UUID,
  p_workflow_id UUID DEFAULT NULL,
  p_scope JSONB DEFAULT '{}'::JSONB,
  p_limit INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  result JSONB;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'viewer', actor);
  IF jsonb_typeof(COALESCE(p_scope, 'null'::JSONB)) <> 'object'
    OR pg_column_size(p_scope) > 16384
    OR p_limit NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'invalid_memory_query' USING ERRCODE = '22023';
  END IF;
  IF p_workflow_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_workflows workflow
    WHERE workflow.id = p_workflow_id AND workflow.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', candidate.id,
    'type', candidate.memory_type,
    'content', CASE WHEN candidate.status='forgotten' THEN NULL ELSE candidate.content END,
    'provenance', candidate.provenance,
    'scope', candidate.scope,
    'confidence', candidate.confidence,
    'status', candidate.status,
    'applicability', jsonb_build_object('workflowId', candidate.workflow_id)
  ) ORDER BY candidate.confidence DESC, candidate.created_at DESC), '[]'::JSONB)
  INTO result
  FROM (
    SELECT row.*
    FROM public.agent_memory_candidates row
    WHERE row.company_id = p_company_id
      AND row.status = 'approved'
      AND (row.expires_at IS NULL OR row.expires_at > now())
      AND (row.retention_until IS NULL OR row.retention_until > now())
      AND (p_workflow_id IS NULL OR row.workflow_id IS NULL OR row.workflow_id = p_workflow_id)
      AND row.scope @> p_scope
    ORDER BY row.confidence DESC, row.created_at DESC
    LIMIT p_limit
  ) candidate;
  RETURN jsonb_build_object('items', result, 'count', jsonb_array_length(result));
END;
$$;

CREATE FUNCTION public.retrieve_agent_memory_v1(
  p_company_id UUID,
  p_workflow_id UUID DEFAULT NULL,
  p_scope JSONB DEFAULT '{}'::JSONB,
  p_limit INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.retrieve_agent_memory(p_company_id, p_workflow_id, p_scope, p_limit)
$$;

CREATE FUNCTION workflow_private.schedule_agent_follow_up(
  p_company_id UUID,
  p_workflow_id UUID,
  p_condition_type TEXT,
  p_due_at TIMESTAMPTZ,
  p_severity TEXT,
  p_rule_version TEXT,
  p_workflow_run_id UUID DEFAULT NULL,
  p_workflow_item_id UUID DEFAULT NULL,
  p_action_attempt_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  target_id UUID;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'member', actor);
  IF p_condition_type NOT IN ('failed','overdue','stale','unresolved')
    OR p_severity NOT IN ('low','medium','high','critical')
    OR p_rule_version !~ '^\d+\.\d+\.\d+$'
    OR p_due_at < now() - interval '1 year'
    OR p_workflow_run_id IS NULL AND p_workflow_item_id IS NULL AND p_action_attempt_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_agent_follow_up' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_workflows workflow
    WHERE workflow.id = p_workflow_id AND workflow.company_id = p_company_id
  ) OR (p_workflow_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workflow_runs run
    WHERE run.id = p_workflow_run_id AND run.company_id = p_company_id
      AND run.workflow_id = p_workflow_id
  )) OR (p_workflow_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workflow_items item
    WHERE item.id = p_workflow_item_id AND item.company_id = p_company_id
      AND item.workflow_id = p_workflow_id
  )) OR (p_action_attempt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workflow_action_attempts attempt
    JOIN public.workflow_runs run
      ON run.id = attempt.workflow_run_id AND run.company_id = attempt.company_id
    WHERE attempt.id = p_action_attempt_id AND attempt.company_id = p_company_id
      AND run.workflow_id = p_workflow_id
  )) THEN
    RAISE EXCEPTION 'follow_up_source_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.agent_follow_ups(
    company_id, workflow_id, workflow_run_id, workflow_item_id, action_attempt_id,
    condition_type, due_at, severity, rule_version, available_at
  ) VALUES (
    p_company_id, p_workflow_id, p_workflow_run_id, p_workflow_item_id,
    p_action_attempt_id, p_condition_type, p_due_at, p_severity,
    p_rule_version, p_due_at
  ) ON CONFLICT DO NOTHING
  RETURNING id INTO target_id;

  IF target_id IS NULL THEN
    SELECT follow_up.id INTO target_id
    FROM public.agent_follow_ups follow_up
    WHERE follow_up.company_id = p_company_id
      AND follow_up.workflow_id = p_workflow_id
      AND follow_up.condition_type = p_condition_type
      AND follow_up.rule_version = p_rule_version
      AND follow_up.workflow_item_id IS NOT DISTINCT FROM p_workflow_item_id
      AND follow_up.action_attempt_id IS NOT DISTINCT FROM p_action_attempt_id
      AND follow_up.status IN ('scheduled','active')
    LIMIT 1;
  END IF;
  RETURN jsonb_build_object('followUpId', target_id, 'status', 'scheduled');
END;
$$;

CREATE FUNCTION public.schedule_agent_follow_up_v1(
  p_company_id UUID,
  p_workflow_id UUID,
  p_condition_type TEXT,
  p_due_at TIMESTAMPTZ,
  p_severity TEXT,
  p_rule_version TEXT,
  p_workflow_run_id UUID DEFAULT NULL,
  p_workflow_item_id UUID DEFAULT NULL,
  p_action_attempt_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.schedule_agent_follow_up(
    p_company_id, p_workflow_id, p_condition_type, p_due_at, p_severity,
    p_rule_version, p_workflow_run_id, p_workflow_item_id, p_action_attempt_id
  )
$$;

CREATE FUNCTION workflow_private.claim_due_agent_follow_ups(
  p_worker_id UUID,
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM workflow_private.require_service_role();
  IF p_worker_id IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_lease_seconds NOT BETWEEN 5 AND 900 THEN
    RAISE EXCEPTION 'invalid_follow_up_claim' USING ERRCODE = '22023';
  END IF;
  WITH claimable AS (
    SELECT follow_up.id
    FROM public.agent_follow_ups follow_up
    JOIN public.agent_runtime_states state
      ON state.company_id = follow_up.company_id
     AND state.workflow_id = follow_up.workflow_id
     AND state.lifecycle_state = 'active'
    WHERE follow_up.status IN ('scheduled','active')
      AND follow_up.available_at <= now()
      AND follow_up.due_at <= now()
      AND (follow_up.leased_until IS NULL OR follow_up.leased_until <= now())
      AND follow_up.attempts < follow_up.max_attempts
    ORDER BY follow_up.severity DESC, follow_up.due_at, follow_up.id
    FOR UPDATE OF follow_up SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.agent_follow_ups follow_up
    SET status = 'active', lease_owner = p_worker_id,
        leased_until = now() + make_interval(secs => p_lease_seconds),
        attempts = follow_up.attempts + 1,
        last_evaluated_at = now()
    FROM claimable
    WHERE follow_up.id = claimable.id
    RETURNING follow_up.*
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', claimed.id, 'companyId', claimed.company_id,
    'workflowId', claimed.workflow_id, 'workflowRunId', claimed.workflow_run_id,
    'workflowItemId', claimed.workflow_item_id, 'actionAttemptId', claimed.action_attempt_id,
    'conditionType', claimed.condition_type, 'dueAt', claimed.due_at,
    'severity', claimed.severity, 'ruleVersion', claimed.rule_version,
    'attempt', claimed.attempts, 'leasedUntil', claimed.leased_until
  ) ORDER BY claimed.due_at, claimed.id), '[]'::JSONB)
  INTO result FROM claimed;
  RETURN jsonb_build_object('items', result, 'count', jsonb_array_length(result));
END;
$$;

CREATE FUNCTION workflow_private.complete_agent_follow_up_claim(
  p_worker_id UUID,
  p_follow_up_id UUID,
  p_outcome TEXT,
  p_resolution JSONB DEFAULT '{}'::JSONB,
  p_active_key TEXT DEFAULT NULL,
  p_escalation_reason TEXT DEFAULT NULL,
  p_retry_delay_seconds INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.agent_follow_ups%ROWTYPE;
  escalation_id UUID;
  next_status TEXT;
BEGIN
  PERFORM workflow_private.require_service_role();
  IF p_outcome NOT IN ('resolved','suppressed','retry','dead_letter','escalated')
    OR jsonb_typeof(COALESCE(p_resolution, 'null'::JSONB)) <> 'object'
    OR pg_column_size(p_resolution) > 65536
    OR p_retry_delay_seconds NOT BETWEEN 5 AND 86400
  THEN
    RAISE EXCEPTION 'invalid_follow_up_completion' USING ERRCODE = '22023';
  END IF;
  SELECT follow_up.* INTO target
  FROM public.agent_follow_ups follow_up
  WHERE follow_up.id = p_follow_up_id
  FOR UPDATE;
  IF NOT FOUND OR target.lease_owner IS DISTINCT FROM p_worker_id OR target.leased_until <= now() THEN
    RAISE EXCEPTION 'follow_up_claim_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_outcome = 'escalated' THEN
    IF p_active_key !~ '^[a-f0-9]{64}$'
      OR length(COALESCE(p_escalation_reason, '')) NOT BETWEEN 1 AND 2000
    THEN
      RAISE EXCEPTION 'invalid_escalation' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.agent_escalations(
      company_id, follow_up_id, workflow_item_id, active_key, reason, severity
    ) VALUES (
      target.company_id, target.id, target.workflow_item_id, p_active_key,
      p_escalation_reason, target.severity
    ) ON CONFLICT DO NOTHING
    RETURNING id INTO escalation_id;
    IF escalation_id IS NULL THEN
      SELECT escalation.id INTO escalation_id
      FROM public.agent_escalations escalation
      WHERE escalation.company_id = target.company_id
        AND escalation.active_key = p_active_key
        AND escalation.status = 'active';
    END IF;
  END IF;

  next_status := CASE
    WHEN p_outcome = 'resolved' THEN 'resolved'
    WHEN p_outcome = 'suppressed' THEN 'suppressed'
    WHEN p_outcome = 'dead_letter' OR (p_outcome = 'retry' AND target.attempts >= target.max_attempts) THEN 'dead_letter'
    ELSE 'active'
  END;
  UPDATE public.agent_follow_ups
  SET status = next_status,
      resolution = CASE WHEN p_outcome IN ('resolved','dead_letter') THEN p_resolution ELSE resolution END,
      suppression = CASE WHEN p_outcome = 'suppressed' THEN p_resolution ELSE suppression END,
      lease_owner = NULL,
      leased_until = NULL,
      available_at = CASE
        WHEN next_status = 'active' THEN now() + make_interval(secs => p_retry_delay_seconds)
        ELSE available_at
      END,
      resolved_at = CASE WHEN next_status = 'resolved' THEN now() ELSE NULL END
  WHERE id = target.id;

  IF p_outcome IN ('resolved','suppressed') THEN
    UPDATE public.agent_escalations
    SET status = p_outcome,
        resolution = p_resolution,
        closed_at = now()
    WHERE company_id = target.company_id AND follow_up_id = target.id AND status = 'active';
  END IF;
  RETURN jsonb_build_object(
    'followUpId', target.id, 'status', next_status,
    'escalationId', escalation_id, 'outcome', p_outcome
  );
END;
$$;

REVOKE ALL ON FUNCTION workflow_private.reject_agent_runtime_history_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.require_service_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_agent_readiness(UUID,UUID,BIGINT,TEXT,JSONB,UUID,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.transition_agent_lifecycle(UUID,UUID,TEXT,BIGINT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.block_inactive_agent_resume_work() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_agent_feedback(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,TEXT,JSONB,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.review_agent_memory_candidate(UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.retrieve_agent_memory(UUID,UUID,JSONB,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.schedule_agent_follow_up(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID,UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.claim_due_agent_follow_ups(UUID,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.complete_agent_follow_up_claim(UUID,UUID,TEXT,JSONB,TEXT,TEXT,INTEGER) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION workflow_private.record_agent_readiness(UUID,UUID,BIGINT,TEXT,JSONB,UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.transition_agent_lifecycle(UUID,UUID,TEXT,BIGINT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.record_agent_feedback(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,TEXT,JSONB,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.review_agent_memory_candidate(UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.retrieve_agent_memory(UUID,UUID,JSONB,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.schedule_agent_follow_up(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.claim_due_agent_follow_ups(UUID,INTEGER,INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION workflow_private.complete_agent_follow_up_claim(UUID,UUID,TEXT,JSONB,TEXT,TEXT,INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.record_agent_readiness_v1(UUID,UUID,BIGINT,TEXT,JSONB,UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_agent_lifecycle_v1(UUID,UUID,TEXT,BIGINT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_agent_feedback_v1(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,TEXT,JSONB,JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_agent_memory_candidate_v1(UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.retrieve_agent_memory_v1(UUID,UUID,JSONB,INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.schedule_agent_follow_up_v1(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID,UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_agent_readiness_v1(UUID,UUID,BIGINT,TEXT,JSONB,UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_agent_lifecycle_v1(UUID,UUID,TEXT,BIGINT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_agent_feedback_v1(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,TEXT,JSONB,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_agent_memory_candidate_v1(UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retrieve_agent_memory_v1(UUID,UUID,JSONB,INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_agent_follow_up_v1(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID,UUID) TO authenticated;

-- Replace the early scalar service drafts with the payload contracts consumed
-- by the 0.0.5 application repositories.
DROP FUNCTION public.record_agent_feedback_v1(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,TEXT,JSONB,JSONB);
DROP FUNCTION public.review_agent_memory_candidate_v1(UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT);
DROP FUNCTION public.retrieve_agent_memory_v1(UUID,UUID,JSONB,INTEGER);
DROP FUNCTION public.schedule_agent_follow_up_v1(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID,UUID);
DROP FUNCTION workflow_private.record_agent_feedback(UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,TEXT,JSONB,JSONB);
DROP FUNCTION workflow_private.review_agent_memory_candidate(UUID,UUID,TEXT,TEXT,TEXT,UUID,TEXT,TEXT);
DROP FUNCTION workflow_private.retrieve_agent_memory(UUID,UUID,JSONB,INTEGER);
DROP FUNCTION workflow_private.schedule_agent_follow_up(UUID,UUID,TEXT,TIMESTAMPTZ,TEXT,TEXT,UUID,UUID,UUID);
DROP FUNCTION workflow_private.claim_due_agent_follow_ups(UUID,INTEGER,INTEGER);
DROP FUNCTION workflow_private.complete_agent_follow_up_claim(UUID,UUID,TEXT,JSONB,TEXT,TEXT,INTEGER);

CREATE FUNCTION workflow_private.agent_memory_candidate_projection(
  candidate public.agent_memory_candidates
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', candidate.id,
    'companyId', candidate.company_id,
    'type', candidate.memory_type,
    'content', CASE WHEN candidate.status='forgotten' THEN NULL ELSE candidate.content END,
    'applicability', candidate.scope,
    'provenance', candidate.provenance,
    'confidence', candidate.confidence::DOUBLE PRECISION,
    'status', candidate.status,
    'reviewerId', candidate.reviewer_id,
    'reviewedAt', candidate.reviewed_at,
    'approvedAt', candidate.approved_at,
    'expiresAt', candidate.expires_at,
    'retentionUntil', candidate.retention_until,
    'supersededById', candidate.superseded_by,
    'forgottenAt', candidate.forgotten_at,
    'revokedAt', candidate.revoked_at,
    'createdAt', candidate.created_at,
    'updatedAt', candidate.updated_at
  )
$$;

CREATE FUNCTION workflow_private.agent_runtime_text_is_safe(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(p_value,'') !~* (
    '(authorization|cookie|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|credential|password|secret|ssn|social[ _-]?security|credit[ _-]?card|card[ _-]?number|cvv|prompt|chain[ _-]?of[ _-]?thought|hidden[ _-]?reasoning'
    || '|bearer[[:space:]]+[a-z0-9._~+/=-]{8,}|sk-[a-z0-9_-]{12,}'
    || '|ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|xoxb-[a-z0-9-]{10,}'
    || '|akia[0-9a-z]{16}|aiza[0-9a-z_-]{20,}'
    || '|-----begin[[:space:]][a-z0-9[:space:]]*private[[:space:]]key-----'
    || '|[0-9]{3}-[0-9]{2}-[0-9]{4}|([0-9][ -]*){13,19}'
    || '|[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+'
    || '|(?:\+?1[ .-]?)?\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4})'
  )
$$;

REVOKE ALL ON FUNCTION workflow_private.agent_runtime_text_is_safe(TEXT)
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION workflow_private.record_agent_feedback_payload(
  p_company_id UUID,
  p_actor_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  feedback public.agent_feedback%ROWTYPE;
  current_version TEXT;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'member', actor);
  IF actor IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload, 'null'::JSONB)) <> 'object'
    OR p_payload - ARRAY[
      'companyId','sourceItemId','recommendationId','recommendationVersion',
      'decision','correction','reason','outcome','clientSurface'
    ] <> '{}'::JSONB
    OR NOT (p_payload ?& ARRAY[
      'companyId','sourceItemId','recommendationId','recommendationVersion',
      'decision','correction','reason','outcome','clientSurface'
    ])
    OR p_payload ->> 'companyId' <> p_company_id::TEXT
    OR (p_payload ->> 'decision') NOT IN ('accepted','edited','rejected','rework','failed','stale','unsafe')
    OR (p_payload ->> 'clientSurface') NOT IN ('cli','web','api','automation')
    OR length(COALESCE(p_payload ->> 'reason','')) NOT BETWEEN 1 AND 2000
    OR length(COALESCE(p_payload ->> 'recommendationVersion','')) NOT BETWEEN 1 AND 128
    OR pg_column_size(p_payload) > 131072
    OR jsonb_typeof(p_payload -> 'outcome') NOT IN ('object','null')
    OR NOT workflow_private.agent_runtime_text_is_safe(
      concat_ws(
        ' ',
        p_payload ->> 'correction',
        p_payload ->> 'reason',
        COALESCE(p_payload -> 'outcome', 'null'::JSONB)::TEXT
      )
    )
  THEN
    RAISE EXCEPTION 'invalid_agent_feedback' USING ERRCODE = '22023';
  END IF;
  IF (p_payload ->> 'decision') IN ('edited','rejected','rework','unsafe')
    AND length(COALESCE(p_payload ->> 'correction','')) NOT BETWEEN 1 AND 2000
  THEN
    RAISE EXCEPTION 'invalid_agent_feedback' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.workflow_items item
    JOIN public.workflow_recommendation_runs recommendation
      ON recommendation.id = (p_payload ->> 'recommendationId')::UUID
     AND recommendation.company_id = item.company_id
     AND recommendation.workflow_item_id = item.id
    WHERE item.id = (p_payload ->> 'sourceItemId')::UUID
      AND item.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'recommendation_not_found' USING ERRCODE = 'P0002';
  END IF;
  current_version := workflow_private.workflow_review_version(
    p_company_id, (p_payload ->> 'sourceItemId')::UUID
  );
  IF current_version IS DISTINCT FROM p_payload ->> 'recommendationVersion' THEN
    RAISE EXCEPTION 'recommendation_version_mismatch' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.agent_feedback(
    company_id, workflow_item_id, recommendation_run_id, recommendation_version,
    actor_id, correction, decision, reason, downstream_outcome, client_surface
  ) VALUES (
    p_company_id, (p_payload ->> 'sourceItemId')::UUID,
    (p_payload ->> 'recommendationId')::UUID, p_payload ->> 'recommendationVersion',
    actor, p_payload ->> 'correction', p_payload ->> 'decision',
    p_payload ->> 'reason', COALESCE(p_payload -> 'outcome', 'null'::JSONB),
    p_payload ->> 'clientSurface'
  ) RETURNING * INTO feedback;

  INSERT INTO public.agent_evaluation_outcome_labels(
    company_id,evaluation_run_id,workflow_run_id,recommendation_run_id,
    recommendation_version,outcome,labelled_by
  )
  SELECT
    p_company_id,
    evaluation.id,
    recommendation.workflow_run_id,
    recommendation.id,
    p_payload ->> 'recommendationVersion',
    CASE p_payload ->> 'decision'
      WHEN 'rework' THEN 'rework_requested'
      ELSE p_payload ->> 'decision'
    END,
    actor
  FROM public.workflow_recommendation_runs recommendation
  LEFT JOIN LATERAL (
    SELECT run.id
    FROM public.agent_evaluation_runs run
    WHERE run.company_id = p_company_id
      AND run.recommendation_run_id = recommendation.id
      AND run.recommendation_version = p_payload ->> 'recommendationVersion'
    ORDER BY run.created_at DESC,run.id DESC
    LIMIT 1
  ) evaluation ON true
  WHERE recommendation.company_id = p_company_id
    AND recommendation.id = (p_payload ->> 'recommendationId')::UUID
  ON CONFLICT (company_id,recommendation_run_id,recommendation_version) DO NOTHING;

  RETURN jsonb_build_object(
    'id', feedback.id,
    'companyId', feedback.company_id,
    'sourceItemId', feedback.workflow_item_id,
    'recommendationId', feedback.recommendation_run_id,
    'recommendationVersion', feedback.recommendation_version,
    'decision', feedback.decision,
    'correction', feedback.correction,
    'reason', feedback.reason,
    'outcome', CASE WHEN feedback.downstream_outcome = 'null'::JSONB THEN NULL ELSE feedback.downstream_outcome END,
    'clientSurface', feedback.client_surface,
    'actorId', feedback.actor_id,
    'createdAt', feedback.created_at
  );
END;
$$;

CREATE FUNCTION public.record_agent_feedback_v1(
  p_company_id UUID,
  p_actor_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT workflow_private.record_agent_feedback_payload(p_company_id,p_actor_id,p_payload) $$;

CREATE FUNCTION workflow_private.create_agent_memory_candidate_payload(
  p_company_id UUID,
  p_actor_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  candidate public.agent_memory_candidates%ROWTYPE;
  source_feedback public.agent_feedback%ROWTYPE;
  source_workflow_id UUID;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'member', actor);
  IF actor IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_payload,'null'::JSONB)) <> 'object'
    OR p_payload - ARRAY['companyId','type','content','applicability','provenance','confidence','expiresAt','retentionUntil'] <> '{}'::JSONB
    OR NOT (p_payload ?& ARRAY['companyId','type','content','applicability','provenance','confidence','expiresAt','retentionUntil'])
    OR p_payload ->> 'companyId' <> p_company_id::TEXT
    OR (p_payload ->> 'type') NOT IN ('correction_pattern','outcome_signal','preference','operating_constraint')
    OR jsonb_typeof(p_payload -> 'content') <> 'object'
    OR jsonb_typeof(p_payload -> 'applicability') <> 'object'
    OR jsonb_typeof(p_payload -> 'provenance') <> 'object'
    OR (p_payload ->> 'confidence')::NUMERIC NOT BETWEEN 0 AND 1
    OR pg_column_size(p_payload) > 131072
    OR NOT workflow_private.agent_runtime_text_is_safe((p_payload -> 'content')::TEXT)
  THEN
    RAISE EXCEPTION 'invalid_memory_candidate' USING ERRCODE = '22023';
  END IF;
  SELECT feedback.* INTO source_feedback
  FROM public.agent_feedback feedback
  WHERE feedback.id = (p_payload #>> '{provenance,sourceFeedbackId}')::UUID
    AND feedback.company_id = p_company_id
    AND feedback.workflow_item_id = (p_payload #>> '{provenance,sourceItemId}')::UUID
    AND feedback.recommendation_run_id = (p_payload #>> '{provenance,recommendationId}')::UUID
    AND feedback.recommendation_version = p_payload #>> '{provenance,recommendationVersion}'
    AND (
      feedback.actor_id = actor
      OR public.has_company_role(p_company_id,'admin')
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_payload #>> '{applicability,userId}' IS NOT NULL
    AND p_payload #>> '{applicability,userId}' IS DISTINCT FROM actor::TEXT
    AND NOT public.has_company_role(p_company_id,'admin')
  THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT item.workflow_id INTO source_workflow_id
  FROM public.workflow_items item
  WHERE item.id = source_feedback.workflow_item_id AND item.company_id = p_company_id;

  INSERT INTO public.agent_memory_candidates(
    company_id, feedback_id, workflow_id, memory_type, content, provenance,
    scope, confidence, expires_at, retention_until
  ) VALUES (
    p_company_id, source_feedback.id, source_workflow_id, p_payload ->> 'type',
    p_payload -> 'content', p_payload -> 'provenance', p_payload -> 'applicability',
    (p_payload ->> 'confidence')::NUMERIC,
    (p_payload ->> 'expiresAt')::TIMESTAMPTZ,
    (p_payload ->> 'retentionUntil')::TIMESTAMPTZ
  ) RETURNING * INTO candidate;
  RETURN workflow_private.agent_memory_candidate_projection(candidate);
END;
$$;

CREATE FUNCTION public.create_agent_memory_candidate_v1(p_company_id UUID,p_actor_id UUID,p_payload JSONB)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$ SELECT workflow_private.create_agent_memory_candidate_payload($1,$2,$3) $$;

CREATE FUNCTION workflow_private.review_agent_memory_candidate_payload(
  p_company_id UUID,
  p_candidate_id UUID,
  p_actor_id UUID,
  p_decision TEXT,
  p_reason TEXT,
  p_expires_at TIMESTAMPTZ,
  p_expected_updated_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  candidate public.agent_memory_candidates%ROWTYPE;
  next_status TEXT;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'admin', actor);
  IF actor IS DISTINCT FROM p_actor_id OR p_decision NOT IN ('approve','reject','revoke')
    OR length(COALESCE(p_reason,'')) NOT BETWEEN 1 AND 1000
  THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE = '22023'; END IF;
  SELECT row.* INTO candidate FROM public.agent_memory_candidates row
  WHERE row.id=p_candidate_id AND row.company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate_not_found' USING ERRCODE='P0002'; END IF;
  IF candidate.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'stale_version' USING ERRCODE='40001';
  END IF;
  IF (candidate.status='pending_review' AND p_decision NOT IN ('approve','reject'))
    OR (candidate.status='approved' AND p_decision <> 'revoke')
    OR candidate.status NOT IN ('pending_review','approved')
  THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE='55000'; END IF;
  next_status := CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'revoked' END;
  UPDATE public.agent_memory_candidates
  SET status=next_status, reviewer_id=actor, reviewed_at=now(),
      approved_at=CASE WHEN next_status='approved' THEN now() ELSE approved_at END,
      expires_at=CASE WHEN next_status='approved' THEN p_expires_at ELSE expires_at END,
      review_reason=p_reason, revoked_at=CASE WHEN next_status='revoked' THEN now() ELSE NULL END
  WHERE id=p_candidate_id RETURNING * INTO candidate;
  RETURN workflow_private.agent_memory_candidate_projection(candidate);
END;
$$;

CREATE FUNCTION public.review_agent_memory_candidate_v1(
  p_company_id UUID,p_candidate_id UUID,p_actor_id UUID,p_decision TEXT,
  p_reason TEXT,p_expires_at TIMESTAMPTZ,p_expected_updated_at TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT workflow_private.review_agent_memory_candidate_payload($1,$2,$3,$4,$5,$6,$7) $$;

CREATE FUNCTION workflow_private.retrieve_agent_memory_payload(
  p_company_id UUID,
  p_scope JSONB,
  p_limit INTEGER,
  p_as_of TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  membership_role TEXT;
  effective_as_of TIMESTAMPTZ;
  result JSONB;
BEGIN
  membership_role := workflow_private.require_company_role(p_company_id,'viewer',actor);
  IF jsonb_typeof(COALESCE(p_scope,'null'::JSONB)) <> 'object'
    OR p_scope - ARRAY['workspaceId','agentId','itemId','vendorId','productId','userId'] <> '{}'::JSONB
    OR p_limit NOT BETWEEN 1 AND 20 OR p_as_of IS NULL
  THEN RAISE EXCEPTION 'invalid_memory_query' USING ERRCODE='22023'; END IF;
  IF p_scope->>'userId' IS NOT NULL
    AND p_scope->>'userId' IS DISTINCT FROM actor::TEXT
    AND public.company_role_rank(membership_role) < public.company_role_rank('admin')
  THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  effective_as_of := GREATEST(p_as_of, clock_timestamp());
  SELECT COALESCE(jsonb_agg(workflow_private.agent_memory_candidate_projection(candidate)
    ORDER BY candidate.confidence DESC,candidate.updated_at DESC),'[]'::JSONB)
  INTO result
  FROM (
    SELECT row.* FROM public.agent_memory_candidates row
    WHERE row.company_id=p_company_id AND row.status='approved' AND row.approved_at IS NOT NULL
      AND row.superseded_by IS NULL AND row.forgotten_at IS NULL AND row.revoked_at IS NULL
      AND (row.expires_at IS NULL OR row.expires_at > effective_as_of)
      AND (row.retention_until IS NULL OR row.retention_until > effective_as_of)
      AND (row.scope->>'workspaceId' IS NULL OR row.scope->>'workspaceId'=p_scope->>'workspaceId')
      AND (row.scope->>'agentId' IS NULL OR row.scope->>'agentId'=p_scope->>'agentId')
      AND (row.scope->>'itemId' IS NULL OR row.scope->>'itemId'=p_scope->>'itemId')
      AND (row.scope->>'vendorId' IS NULL OR row.scope->>'vendorId'=p_scope->>'vendorId')
      AND (row.scope->>'productId' IS NULL OR row.scope->>'productId'=p_scope->>'productId')
      AND (row.scope->>'userId' IS NULL OR row.scope->>'userId'=p_scope->>'userId')
    ORDER BY row.confidence DESC,row.updated_at DESC LIMIT p_limit
  ) candidate;
  RETURN result;
END;
$$;

CREATE FUNCTION public.retrieve_agent_memory_v1(p_company_id UUID,p_scope JSONB,p_limit INTEGER,p_as_of TIMESTAMPTZ)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT workflow_private.retrieve_agent_memory_payload($1,$2,$3,$4) $$;

CREATE FUNCTION workflow_private.forget_agent_memory_candidate_payload(
  p_company_id UUID,p_candidate_id UUID,p_actor_id UUID,p_reason TEXT,p_expected_updated_at TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE actor UUID := (SELECT auth.uid()); candidate public.agent_memory_candidates%ROWTYPE;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id,'admin',actor);
  IF actor IS DISTINCT FROM p_actor_id OR length(COALESCE(p_reason,'')) NOT BETWEEN 1 AND 1000
  THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE='22023'; END IF;
  SELECT row.* INTO candidate FROM public.agent_memory_candidates row
  WHERE row.id=p_candidate_id AND row.company_id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate_not_found' USING ERRCODE='P0002'; END IF;
  IF candidate.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'stale_version' USING ERRCODE='40001'; END IF;
  IF candidate.status='forgotten' THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE='55000'; END IF;
  UPDATE public.agent_memory_candidates SET status='forgotten',reviewer_id=actor,reviewed_at=now(),
    review_reason=p_reason,content='{}'::JSONB,forgotten_at=now(),provider_reference=NULL
  WHERE id=p_candidate_id RETURNING * INTO candidate;
  RETURN jsonb_build_object('id',candidate.id,'companyId',candidate.company_id,'status','forgotten','forgottenAt',candidate.forgotten_at);
END;
$$;

CREATE FUNCTION public.forget_agent_memory_candidate_v1(
  p_company_id UUID,p_candidate_id UUID,p_actor_id UUID,p_reason TEXT,p_expected_updated_at TIMESTAMPTZ
)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT workflow_private.forget_agent_memory_candidate_payload($1,$2,$3,$4,$5) $$;

CREATE FUNCTION workflow_private.export_agent_memory_payload(p_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE actor UUID := (SELECT auth.uid()); result JSONB;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id,'admin',actor);
  SELECT COALESCE(jsonb_agg(workflow_private.agent_memory_candidate_projection(candidate)
    ORDER BY candidate.created_at,candidate.id),'[]'::JSONB)
  INTO result FROM (
    SELECT row.* FROM public.agent_memory_candidates row
    WHERE row.company_id=p_company_id ORDER BY row.created_at,row.id LIMIT 10000
  ) candidate;
  RETURN result;
END;
$$;

CREATE FUNCTION public.export_agent_memory_v1(p_company_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT workflow_private.export_agent_memory_payload($1) $$;

CREATE FUNCTION workflow_private.agent_follow_up_projection(follow_up public.agent_follow_ups)
RETURNS JSONB LANGUAGE sql STABLE SET search_path=''
AS $$
  SELECT jsonb_build_object(
    'id',follow_up.id,'companyId',follow_up.company_id,'workflowId',follow_up.workflow_id,
    'workflowRunId',follow_up.workflow_run_id,'sourceItemId',follow_up.workflow_item_id,
    'actionAttemptId',follow_up.action_attempt_id,'condition',follow_up.condition,
    'dueAt',follow_up.due_at,'severity',follow_up.severity,'ruleVersion',follow_up.rule_version,
    'recurrencePolicy',follow_up.recurrence_policy,'maxAttempts',follow_up.max_attempts,
    'status',CASE WHEN follow_up.lease_owner IS NOT NULL THEN 'leased' ELSE follow_up.status END,
    'occurrence',follow_up.occurrence,'attempts',follow_up.attempts,
    'leaseOwner',follow_up.lease_owner,'leaseExpiresAt',follow_up.leased_until,
    'lastEvaluatedAt',follow_up.last_evaluated_at,'createdAt',follow_up.created_at,'updatedAt',follow_up.updated_at
  )
$$;

CREATE FUNCTION workflow_private.agent_escalation_projection(escalation public.agent_escalations)
RETURNS JSONB LANGUAGE sql STABLE SET search_path=''
AS $$
  SELECT jsonb_build_object(
    'id',escalation.id,'companyId',escalation.company_id,'followUpId',escalation.follow_up_id,
    'sourceItemId',escalation.workflow_item_id,'activeKey',escalation.active_key,
    'reason',escalation.reason,'severity',escalation.severity,
    'status',CASE escalation.status WHEN 'active' THEN 'open' ELSE escalation.status END,
    'occurrence',escalation.occurrence,'openedAt',escalation.opened_at,
    'resolvedAt',escalation.closed_at,'updatedAt',escalation.updated_at
  )
$$;

CREATE FUNCTION workflow_private.schedule_agent_follow_up_payload(
  p_company_id UUID,p_actor_id UUID,p_payload JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid()); target public.agent_follow_ups%ROWTYPE;
  source_item public.workflow_items%ROWTYPE; workflow_id_value UUID; condition_type_value TEXT;
  next_occurrence INTEGER; recurrence_event TEXT;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id,'admin',actor);
  IF actor IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(COALESCE(p_payload,'null'::JSONB)) <> 'object'
    OR p_payload - ARRAY['companyId','workflowId','workflowRunId','sourceItemId','actionAttemptId','condition','dueAt','severity','ruleVersion','recurrencePolicy','maxAttempts'] <> '{}'::JSONB
    OR NOT (p_payload ?& ARRAY['companyId','workflowId','workflowRunId','sourceItemId','actionAttemptId','condition','dueAt','severity','ruleVersion','recurrencePolicy','maxAttempts'])
    OR p_payload->>'companyId' <> p_company_id::TEXT
    OR jsonb_typeof(p_payload->'condition') <> 'object'
    OR p_payload#>>'{condition,type}' NOT IN ('failure','overdue','stale','unresolved')
    OR p_payload->>'severity' NOT IN ('low','medium','high','critical')
    OR p_payload->>'recurrencePolicy' NOT IN ('reopen','new_occurrence')
    OR (p_payload->>'maxAttempts')::INTEGER NOT BETWEEN 1 AND 20
    OR length(COALESCE(p_payload->>'ruleVersion','')) NOT BETWEEN 1 AND 64
    OR pg_column_size(p_payload)>65536
  THEN RAISE EXCEPTION 'invalid_agent_follow_up' USING ERRCODE='22023'; END IF;
  SELECT item.* INTO source_item FROM public.workflow_items item
  WHERE item.id=(p_payload->>'sourceItemId')::UUID AND item.company_id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'follow_up_not_found' USING ERRCODE='P0002'; END IF;
  workflow_id_value:=source_item.workflow_id;
  IF p_payload->>'workflowId' IS NOT NULL AND (p_payload->>'workflowId')::UUID <> workflow_id_value
  THEN RAISE EXCEPTION 'follow_up_not_found' USING ERRCODE='P0002'; END IF;
  IF p_payload->>'workflowRunId' IS NOT NULL AND (p_payload->>'workflowRunId')::UUID <> source_item.workflow_run_id
  THEN RAISE EXCEPTION 'follow_up_not_found' USING ERRCODE='P0002'; END IF;
  condition_type_value:=CASE p_payload#>>'{condition,type}' WHEN 'failure' THEN 'failed' ELSE p_payload#>>'{condition,type}' END;

  -- Serialize this condition identity even when no prior row exists so two
  -- schedulers cannot both advance the same occurrence.
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':',
    p_company_id::TEXT,workflow_id_value::TEXT,source_item.id::TEXT,
    COALESCE(p_payload->>'actionAttemptId',''),condition_type_value,p_payload->>'ruleVersion'
  ),0));
  SELECT row.* INTO target FROM public.agent_follow_ups row
  WHERE row.company_id=p_company_id AND row.workflow_id=workflow_id_value
    AND row.workflow_item_id=source_item.id
    AND row.action_attempt_id IS NOT DISTINCT FROM (p_payload->>'actionAttemptId')::UUID
    AND row.condition_type=condition_type_value AND row.rule_version=p_payload->>'ruleVersion'
  ORDER BY row.occurrence DESC,row.created_at DESC,row.id DESC LIMIT 1 FOR UPDATE;

  IF target.id IS NULL THEN
    INSERT INTO public.agent_follow_ups(
      company_id,workflow_id,workflow_run_id,workflow_item_id,action_attempt_id,
      condition_type,condition,due_at,severity,rule_version,recurrence_policy,max_attempts,available_at,occurrence
    ) VALUES (
      p_company_id,workflow_id_value,source_item.workflow_run_id,source_item.id,
      (p_payload->>'actionAttemptId')::UUID,condition_type_value,p_payload->'condition',
      (p_payload->>'dueAt')::TIMESTAMPTZ,p_payload->>'severity',p_payload->>'ruleVersion',
      p_payload->>'recurrencePolicy',(p_payload->>'maxAttempts')::INTEGER,(p_payload->>'dueAt')::TIMESTAMPTZ,1
    ) RETURNING * INTO target;
    INSERT INTO public.agent_monitoring_events(
      company_id,follow_up_id,event_type,occurrence,actor_type,actor_id,reason,details
    ) VALUES (
      p_company_id,target.id,'scheduled',target.occurrence,'user',actor,
      'Follow-up scheduled',jsonb_build_object('dueAt',target.due_at,'recurrencePolicy',target.recurrence_policy)
    );
  ELSIF target.status IN ('scheduled','active') THEN
    INSERT INTO public.agent_monitoring_events(
      company_id,follow_up_id,event_type,occurrence,actor_type,actor_id,reason,details
    ) VALUES (
      p_company_id,target.id,'deduplicated',target.occurrence,'user',actor,
      'Open follow-up already exists',jsonb_build_object('status',target.status)
    );
  ELSE
    next_occurrence:=target.occurrence+1;
    recurrence_event:=CASE p_payload->>'recurrencePolicy' WHEN 'reopen' THEN 'reopened' ELSE 'new_occurrence' END;
    IF p_payload->>'recurrencePolicy'='reopen' THEN
      UPDATE public.agent_follow_ups SET
        workflow_run_id=source_item.workflow_run_id,condition=p_payload->'condition',
        due_at=(p_payload->>'dueAt')::TIMESTAMPTZ,severity=p_payload->>'severity',
        recurrence_policy='reopen',occurrence=next_occurrence,status='scheduled',
        attempts=0,max_attempts=(p_payload->>'maxAttempts')::INTEGER,
        available_at=(p_payload->>'dueAt')::TIMESTAMPTZ,last_evaluated_at=NULL,
        resolution='{}'::JSONB,suppression='{}'::JSONB,resolved_at=NULL,
        lease_id=NULL,lease_owner=NULL,leased_until=NULL
      WHERE id=target.id RETURNING * INTO target;
    ELSE
      INSERT INTO public.agent_follow_ups(
        company_id,workflow_id,workflow_run_id,workflow_item_id,action_attempt_id,
        condition_type,condition,due_at,severity,rule_version,recurrence_policy,max_attempts,available_at,occurrence
      ) VALUES (
        p_company_id,workflow_id_value,source_item.workflow_run_id,source_item.id,
        (p_payload->>'actionAttemptId')::UUID,condition_type_value,p_payload->'condition',
        (p_payload->>'dueAt')::TIMESTAMPTZ,p_payload->>'severity',p_payload->>'ruleVersion',
        'new_occurrence',(p_payload->>'maxAttempts')::INTEGER,(p_payload->>'dueAt')::TIMESTAMPTZ,next_occurrence
      ) RETURNING * INTO target;
    END IF;
    INSERT INTO public.agent_monitoring_events(
      company_id,follow_up_id,event_type,occurrence,actor_type,actor_id,reason,details
    ) VALUES (
      p_company_id,target.id,recurrence_event,target.occurrence,'user',actor,
      CASE recurrence_event WHEN 'reopened' THEN 'Closed follow-up reopened' ELSE 'New follow-up occurrence created' END,
      jsonb_build_object('recurrencePolicy',target.recurrence_policy)
    );
  END IF;
  RETURN workflow_private.agent_follow_up_projection(target);
END;
$$;

CREATE FUNCTION public.schedule_agent_follow_up_v1(p_company_id UUID,p_actor_id UUID,p_payload JSONB)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT workflow_private.schedule_agent_follow_up_payload($1,$2,$3) $$;

CREATE FUNCTION workflow_private.claim_due_agent_follow_ups(
  p_worker_id TEXT,p_limit INTEGER,p_lease_seconds INTEGER,p_now TIMESTAMPTZ
)
RETURNS TABLE("leaseId" UUID,"followUp" JSONB,"observation" JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  PERFORM workflow_private.require_service_role();
  IF length(COALESCE(p_worker_id,'')) NOT BETWEEN 1 AND 128 OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds NOT BETWEEN 15 AND 900 OR p_now IS NULL
  THEN RAISE EXCEPTION 'invalid_follow_up_claim' USING ERRCODE='22023'; END IF;
  RETURN QUERY
  WITH claimable AS (
    SELECT follow_up.id FROM public.agent_follow_ups follow_up
    JOIN public.agent_runtime_states state ON state.company_id=follow_up.company_id
      AND state.workflow_id=follow_up.workflow_id AND state.lifecycle_state='active'
    WHERE follow_up.status IN ('scheduled','active') AND follow_up.available_at<=p_now AND follow_up.due_at<=p_now
      AND (follow_up.leased_until IS NULL OR follow_up.leased_until<=p_now) AND follow_up.attempts<follow_up.max_attempts
    ORDER BY follow_up.due_at,follow_up.id FOR UPDATE OF follow_up SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.agent_follow_ups follow_up SET status='active',lease_id=gen_random_uuid(),lease_owner=p_worker_id,
      leased_until=p_now+make_interval(secs=>p_lease_seconds),attempts=follow_up.attempts+1,last_evaluated_at=p_now
    FROM claimable WHERE follow_up.id=claimable.id RETURNING follow_up.*
  ), logged AS (
    INSERT INTO public.agent_monitoring_events(
      company_id,follow_up_id,event_type,occurrence,actor_type,worker_id,reason,details
    )
    SELECT claimed.company_id,claimed.id,'claimed',claimed.occurrence,'worker',p_worker_id,
      'Follow-up claimed for evaluation',
      jsonb_build_object('leaseId',claimed.lease_id,'leasedUntil',claimed.leased_until,'attempt',claimed.attempts)
    FROM claimed
    RETURNING follow_up_id
  )
  SELECT claimed.lease_id,workflow_private.agent_follow_up_projection(claimed),
    jsonb_build_object(
      'sourceStatus',COALESCE(
        attempt.status,
        CASE item.status WHEN 'executed' THEN 'succeeded' WHEN 'resolved' THEN 'resolved'
          WHEN 'rejected' THEN 'suppressed' WHEN 'approved' THEN 'processing' ELSE 'pending' END
      ),
      'lastActivityAt',COALESCE(attempt.completed_at,attempt.created_at,item.updated_at,claimed.updated_at),
      'resolvedAt',CASE WHEN item.status='resolved' THEN item.updated_at ELSE NULL END
    )
  FROM claimed
  LEFT JOIN public.workflow_action_attempts attempt ON attempt.id=claimed.action_attempt_id AND attempt.company_id=claimed.company_id
  LEFT JOIN public.workflow_items item ON item.id=claimed.workflow_item_id AND item.company_id=claimed.company_id
  WHERE EXISTS (SELECT 1 FROM logged WHERE logged.follow_up_id=claimed.id);
END;
$$;

CREATE FUNCTION workflow_private.complete_agent_follow_up_claim(
  p_worker_id TEXT,p_lease_id UUID,p_decision JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  target public.agent_follow_ups%ROWTYPE; escalation public.agent_escalations%ROWTYPE;
  duplicate BOOLEAN:=false; decision_reason TEXT; evaluated_at TIMESTAMPTZ;
BEGIN
  PERFORM workflow_private.require_service_role();
  IF jsonb_typeof(COALESCE(p_decision,'null'::JSONB))<>'object'
    OR p_decision-ARRAY['qualifies','activeKey','reason','evaluatedAt']<>'{}'::JSONB
    OR NOT (p_decision?&ARRAY['qualifies','activeKey','reason','evaluatedAt'])
    OR length(COALESCE(p_decision->>'activeKey','')) NOT BETWEEN 1 AND 512
  THEN RAISE EXCEPTION 'invalid_follow_up_completion' USING ERRCODE='22023'; END IF;
  SELECT row.* INTO target FROM public.agent_follow_ups row WHERE row.lease_id=p_lease_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'follow_up_not_found' USING ERRCODE='P0002'; END IF;
  IF target.lease_owner IS DISTINCT FROM p_worker_id OR target.leased_until<=now()
  THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001'; END IF;
  decision_reason:=p_decision->>'reason'; evaluated_at:=(p_decision->>'evaluatedAt')::TIMESTAMPTZ;
  IF (p_decision->>'qualifies')::BOOLEAN THEN
    INSERT INTO public.agent_escalations(company_id,follow_up_id,workflow_item_id,active_key,reason,severity,occurrence)
    VALUES(target.company_id,target.id,target.workflow_item_id,p_decision->>'activeKey',decision_reason,target.severity,target.occurrence)
    ON CONFLICT DO NOTHING RETURNING * INTO escalation;
    IF escalation.id IS NULL THEN
      duplicate:=true;
      SELECT row.* INTO escalation FROM public.agent_escalations row
      WHERE row.company_id=target.company_id AND row.active_key=p_decision->>'activeKey' AND row.status='active';
    END IF;
    UPDATE public.agent_follow_ups SET lease_id=NULL,lease_owner=NULL,leased_until=NULL,
      available_at=evaluated_at+interval '5 minutes',last_evaluated_at=evaluated_at WHERE id=target.id;
    INSERT INTO public.agent_monitoring_events(
      company_id,follow_up_id,escalation_id,event_type,occurrence,actor_type,worker_id,reason,details
    ) VALUES (
      target.company_id,target.id,escalation.id,
      CASE WHEN duplicate THEN 'deduplicated' ELSE 'escalated' END,target.occurrence,
      'worker',p_worker_id,decision_reason,jsonb_build_object('activeKey',p_decision->>'activeKey')
    );
  ELSE
    UPDATE public.agent_escalations SET status=CASE WHEN decision_reason='source_resolved' THEN 'resolved' ELSE 'suppressed' END,
      closed_at=evaluated_at,resolution=jsonb_build_object('reason',decision_reason)
    WHERE company_id=target.company_id AND follow_up_id=target.id AND status='active'
    RETURNING * INTO escalation;
    UPDATE public.agent_follow_ups SET status=CASE WHEN decision_reason='source_resolved' THEN 'resolved' ELSE 'suppressed' END,
      lease_id=NULL,lease_owner=NULL,leased_until=NULL,last_evaluated_at=evaluated_at,
      resolved_at=CASE WHEN decision_reason='source_resolved' THEN evaluated_at ELSE NULL END,
      resolution=CASE WHEN decision_reason='source_resolved' THEN jsonb_build_object('reason',decision_reason) ELSE resolution END,
      suppression=CASE WHEN decision_reason<>'source_resolved' THEN jsonb_build_object('reason',decision_reason) ELSE suppression END
    WHERE id=target.id;
    INSERT INTO public.agent_monitoring_events(
      company_id,follow_up_id,escalation_id,event_type,occurrence,actor_type,worker_id,reason,details
    ) VALUES (
      target.company_id,target.id,escalation.id,
      CASE WHEN decision_reason='source_resolved' THEN 'resolved' ELSE 'suppressed' END,
      target.occurrence,'worker',p_worker_id,decision_reason,'{}'::JSONB
    );
  END IF;
  RETURN jsonb_build_object('escalation',CASE WHEN escalation.id IS NULL THEN NULL ELSE workflow_private.agent_escalation_projection(escalation) END,'duplicate',duplicate);
END;
$$;

CREATE FUNCTION workflow_private.fail_agent_follow_up_claim(
  p_worker_id TEXT,p_lease_id UUID,p_retryable BOOLEAN,p_error_code TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  target public.agent_follow_ups%ROWTYPE;
  escalation public.agent_escalations%ROWTYPE;
  dead_letter BOOLEAN;
BEGIN
  PERFORM workflow_private.require_service_role();
  IF length(COALESCE(p_error_code,'')) NOT BETWEEN 1 AND 64 OR p_error_code!~'^[a-z0-9_]+$'
  THEN RAISE EXCEPTION 'invalid_follow_up_failure' USING ERRCODE='22023'; END IF;
  SELECT row.* INTO target FROM public.agent_follow_ups row WHERE row.lease_id=p_lease_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'follow_up_not_found' USING ERRCODE='P0002'; END IF;
  IF target.lease_owner IS DISTINCT FROM p_worker_id OR target.leased_until<=now()
  THEN RAISE EXCEPTION 'lease_lost' USING ERRCODE='40001'; END IF;
  dead_letter:=NOT (p_retryable AND target.attempts<target.max_attempts);
  UPDATE public.agent_follow_ups SET status=CASE WHEN dead_letter THEN 'dead_letter' ELSE 'scheduled' END,
    lease_id=NULL,lease_owner=NULL,leased_until=NULL,available_at=now()+interval '1 minute',
    resolution=jsonb_build_object('errorCode',p_error_code,'retryable',p_retryable)
  WHERE id=target.id;
  IF dead_letter THEN
    UPDATE public.agent_escalations SET
      status='suppressed',closed_at=now(),
      resolution=jsonb_build_object('reason','follow_up_dead_lettered','errorCode',p_error_code)
    WHERE company_id=target.company_id AND follow_up_id=target.id AND status='active'
    RETURNING * INTO escalation;
    IF escalation.id IS NOT NULL THEN
      INSERT INTO public.agent_monitoring_events(
        company_id,follow_up_id,escalation_id,event_type,occurrence,actor_type,worker_id,reason,details
      ) VALUES (
        target.company_id,target.id,escalation.id,'suppressed',target.occurrence,
        'worker',p_worker_id,'follow_up_dead_lettered',jsonb_build_object('errorCode',p_error_code)
      );
    END IF;
  END IF;
  INSERT INTO public.agent_monitoring_events(
    company_id,follow_up_id,escalation_id,event_type,occurrence,actor_type,worker_id,reason,details
  ) VALUES (
    target.company_id,target.id,escalation.id,
    CASE WHEN dead_letter THEN 'dead_letter' ELSE 'retry_scheduled' END,
    target.occurrence,'worker',p_worker_id,p_error_code,jsonb_build_object('retryable',p_retryable)
  );
END;
$$;

REVOKE ALL ON FUNCTION workflow_private.agent_memory_candidate_projection(public.agent_memory_candidates) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_agent_feedback_payload(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.create_agent_memory_candidate_payload(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.review_agent_memory_candidate_payload(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.retrieve_agent_memory_payload(UUID,JSONB,INTEGER,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.forget_agent_memory_candidate_payload(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.export_agent_memory_payload(UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.agent_follow_up_projection(public.agent_follow_ups) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.agent_escalation_projection(public.agent_escalations) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.schedule_agent_follow_up_payload(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.claim_due_agent_follow_ups(TEXT,INTEGER,INTEGER,TIMESTAMPTZ) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.complete_agent_follow_up_claim(TEXT,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.fail_agent_follow_up_claim(TEXT,UUID,BOOLEAN,TEXT) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION workflow_private.agent_follow_up_projection(public.agent_follow_ups) TO service_role;
GRANT EXECUTE ON FUNCTION workflow_private.agent_escalation_projection(public.agent_escalations) TO service_role;
GRANT EXECUTE ON FUNCTION workflow_private.claim_due_agent_follow_ups(TEXT,INTEGER,INTEGER,TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION workflow_private.complete_agent_follow_up_claim(TEXT,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION workflow_private.fail_agent_follow_up_claim(TEXT,UUID,BOOLEAN,TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.record_agent_feedback_v1(UUID,UUID,JSONB) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_agent_memory_candidate_v1(UUID,UUID,JSONB) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.review_agent_memory_candidate_v1(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.retrieve_agent_memory_v1(UUID,JSONB,INTEGER,TIMESTAMPTZ) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.forget_agent_memory_candidate_v1(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.export_agent_memory_v1(UUID) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.schedule_agent_follow_up_v1(UUID,UUID,JSONB) FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.record_agent_feedback_v1(UUID,UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_agent_memory_candidate_v1(UUID,UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_agent_memory_candidate_v1(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.retrieve_agent_memory_v1(UUID,JSONB,INTEGER,TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forget_agent_memory_candidate_v1(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_agent_memory_v1(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_agent_follow_up_v1(UUID,UUID,JSONB) TO authenticated;

-- Public wrappers are the only callable API. They are narrowly granted,
-- use an empty search path, and delegate to private functions that re-check
-- auth.uid() and company role internally.
ALTER FUNCTION public.record_agent_readiness_v1(UUID,UUID,BIGINT,TEXT,JSONB,UUID,TEXT) SECURITY DEFINER;
ALTER FUNCTION public.transition_agent_lifecycle_v1(UUID,UUID,TEXT,BIGINT,TEXT) SECURITY DEFINER;
ALTER FUNCTION public.record_agent_feedback_v1(UUID,UUID,JSONB) SECURITY DEFINER;
ALTER FUNCTION public.create_agent_memory_candidate_v1(UUID,UUID,JSONB) SECURITY DEFINER;
ALTER FUNCTION public.review_agent_memory_candidate_v1(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) SECURITY DEFINER;
ALTER FUNCTION public.retrieve_agent_memory_v1(UUID,JSONB,INTEGER,TIMESTAMPTZ) SECURITY DEFINER;
ALTER FUNCTION public.forget_agent_memory_candidate_v1(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) SECURITY DEFINER;
ALTER FUNCTION public.export_agent_memory_v1(UUID) SECURITY DEFINER;
ALTER FUNCTION public.schedule_agent_follow_up_v1(UUID,UUID,JSONB) SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION workflow_private.record_agent_readiness(UUID,UUID,BIGINT,TEXT,JSONB,UUID,TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION workflow_private.transition_agent_lifecycle(UUID,UUID,TEXT,BIGINT,TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION workflow_private.record_agent_feedback_payload(UUID,UUID,JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION workflow_private.create_agent_memory_candidate_payload(UUID,UUID,JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION workflow_private.review_agent_memory_candidate_payload(UUID,UUID,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM authenticated;
REVOKE EXECUTE ON FUNCTION workflow_private.retrieve_agent_memory_payload(UUID,JSONB,INTEGER,TIMESTAMPTZ) FROM authenticated;
REVOKE EXECUTE ON FUNCTION workflow_private.forget_agent_memory_candidate_payload(UUID,UUID,UUID,TEXT,TIMESTAMPTZ) FROM authenticated;
REVOKE EXECUTE ON FUNCTION workflow_private.export_agent_memory_payload(UUID) FROM authenticated;
REVOKE EXECUTE ON FUNCTION workflow_private.schedule_agent_follow_up_payload(UUID,UUID,JSONB) FROM authenticated;

CREATE FUNCTION workflow_private.get_agent_runtime_state_payload(p_company_id UUID,p_workflow_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE actor UUID := (SELECT auth.uid()); target public.agent_runtime_states%ROWTYPE;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id,'viewer',actor);
  SELECT row.* INTO target FROM public.agent_runtime_states row
  WHERE row.company_id=p_company_id AND row.workflow_id=p_workflow_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'agent_state_not_found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object(
    'runtimeStateId',target.id,'companyId',target.company_id,'workflowId',target.workflow_id,
    'lifecycleState',target.lifecycle_state,'stateVersion',target.state_version,
    'readinessStatus',target.readiness_status,'readinessIssues',target.readiness_issues,
    'readinessHash',target.readiness_hash,'readinessCheckedAt',target.readiness_checked_at,
    'sampleRunId',target.last_sample_run_id,'bindingSnapshotId',target.binding_snapshot_id,
    'updatedAt',target.updated_at
  );
END;
$$;

CREATE FUNCTION public.get_agent_runtime_state_v1(p_company_id UUID,p_workflow_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT workflow_private.get_agent_runtime_state_payload($1,$2) $$;

REVOKE ALL ON FUNCTION workflow_private.get_agent_runtime_state_payload(UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_agent_runtime_state_v1(UUID,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_agent_runtime_state_v1(UUID,UUID) TO authenticated;

-- Keep the existing version rollback RPC as the single version-switching
-- boundary, but synchronize the 0.0.5 lifecycle records in the same
-- transaction. Legacy companies without runtime-state rows keep the prior
-- activation behavior; once a workflow has a runtime state, both source and
-- target versions must participate in the controlled lifecycle.
CREATE FUNCTION workflow_private.rollback_agent_workflow_runtime_bridge(
  p_company_id UUID,p_workflow_id UUID,p_binding_snapshot_id UUID,p_expected_current_workflow_id UUID,
  p_expected_state_version BIGINT,p_reason TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid()); source_state public.agent_runtime_states%ROWTYPE;
  target_state public.agent_runtime_states%ROWTYPE; target_workflow public.agent_workflows%ROWTYPE;
  activation_result JSONB;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id,'admin',actor);
  IF p_expected_state_version < 1 OR length(trim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_rollback_request' USING ERRCODE='22023';
  END IF;
  SELECT workflow.* INTO target_workflow FROM public.agent_workflows workflow
  WHERE workflow.id=p_workflow_id AND workflow.company_id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_not_found' USING ERRCODE='P0002'; END IF;

  SELECT state.* INTO source_state FROM public.agent_runtime_states state
  WHERE state.company_id=p_company_id AND state.workflow_id=p_expected_current_workflow_id FOR UPDATE;
  IF FOUND THEN
    IF source_state.state_version<>p_expected_state_version THEN
      RAISE EXCEPTION 'stale_agent_state' USING ERRCODE='40001';
    END IF;
    IF p_workflow_id=p_expected_current_workflow_id THEN
      RAISE EXCEPTION 'rollback_target_must_differ' USING ERRCODE='22023';
    END IF;
    IF source_state.lifecycle_state<>'active' THEN
      RAISE EXCEPTION 'rollback_source_not_active' USING ERRCODE='55000';
    END IF;
    SELECT state.* INTO target_state FROM public.agent_runtime_states state
    WHERE state.company_id=p_company_id AND state.workflow_id=p_workflow_id FOR UPDATE;
    IF NOT FOUND OR target_state.lifecycle_state<>'ready' OR target_state.readiness_status<>'ready'
      OR target_state.readiness_hash IS NULL OR jsonb_array_length(target_state.readiness_issues)<>0
    THEN RAISE EXCEPTION 'rollback_target_not_ready' USING ERRCODE='55000'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.agent_promotion_checkpoints checkpoint
      WHERE checkpoint.company_id=p_company_id AND checkpoint.workflow_id=p_workflow_id
        AND checkpoint.workflow_version=target_workflow.version AND checkpoint.decision='blocked'
    ) THEN RAISE EXCEPTION 'promotion_checkpoint_blocked' USING ERRCODE='55000'; END IF;
  END IF;

  activation_result:=workflow_private.transition_workflow_activation(
    p_company_id,p_workflow_id,p_binding_snapshot_id,p_expected_current_workflow_id,'rolled_back'
  );
  IF source_state.id IS NOT NULL THEN
    UPDATE public.agent_runtime_states SET lifecycle_state='ready',state_version=state_version+1,updated_by=actor
    WHERE id=source_state.id RETURNING * INTO source_state;
    UPDATE public.workflow_resume_outbox outbox SET status='failed',leased_until=NULL,
      checkpoint=outbox.checkpoint||jsonb_build_object('blockedByLifecycle','rollback','blockedAt',now())
    WHERE outbox.company_id=p_company_id AND outbox.workflow_run_id IN (
      SELECT run.id FROM public.workflow_runs run WHERE run.company_id=p_company_id AND run.workflow_id=p_expected_current_workflow_id
    ) AND outbox.status IN ('pending','processing');
    INSERT INTO public.agent_lifecycle_events(
      company_id,runtime_state_id,workflow_id,transition,from_state,to_state,state_version,reason,actor_id
    ) VALUES(p_company_id,source_state.id,p_expected_current_workflow_id,'rollback','active','ready',source_state.state_version,trim(p_reason),actor);

    UPDATE public.agent_runtime_states SET lifecycle_state='active',state_version=state_version+1,
      binding_snapshot_id=p_binding_snapshot_id,readiness_checked_at=clock_timestamp(),updated_by=actor
    WHERE id=target_state.id RETURNING * INTO target_state;
    INSERT INTO public.agent_lifecycle_events(
      company_id,runtime_state_id,workflow_id,transition,from_state,to_state,state_version,reason,actor_id
    ) VALUES(p_company_id,target_state.id,p_workflow_id,'rollback','ready','active',target_state.state_version,'Activated rollback target. '||trim(p_reason),actor);
  END IF;
  RETURN activation_result||jsonb_build_object(
    'sourceRuntimeStateId',source_state.id,'targetRuntimeStateId',target_state.id,
    'targetStateVersion',target_state.state_version
  );
END;
$$;

DROP FUNCTION public.rollback_agent_workflow(UUID,UUID,UUID,UUID);

CREATE FUNCTION public.rollback_agent_workflow(
  p_company_id UUID,p_workflow_id UUID,p_binding_snapshot_id UUID,p_expected_current_workflow_id UUID,
  p_expected_state_version BIGINT,p_reason TEXT
)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT workflow_private.rollback_agent_workflow_runtime_bridge($1,$2,$3,$4,$5,$6) $$;

REVOKE ALL ON FUNCTION workflow_private.rollback_agent_workflow_runtime_bridge(UUID,UUID,UUID,UUID,BIGINT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.rollback_agent_workflow(UUID,UUID,UUID,UUID,BIGINT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rollback_agent_workflow(UUID,UUID,UUID,UUID,BIGINT,TEXT) TO authenticated;

-- Execution remains on the established approval/token endpoint, but every
-- attempt is now bound to the platform registry and rechecks the exact agent
-- lifecycle and binding snapshot under a database lock immediately before the
-- adapter write. The receipt trigger makes the existing idempotent attempt a
-- durable 0.0.5 execution receipt as part of the same transaction.
INSERT INTO public.agent_action_definitions(
  action_key,version,capability_version_id,input_schema,output_schema,allowed_modes,approval_rule,
  timeout_ms,retry_class,idempotency_scope,audit_classification,status
) SELECT
  'execute_mock_purchase_order','1.0.0',
  capability_version.id,
  '{"type":"object"}'::JSONB,'{"type":"object"}'::JSONB,
  ARRAY['fixture','mock','dry_run','shadow']::TEXT[],
  '{"humanRequired":true}'::JSONB,30000,'never','action','confidential','active'
FROM public.capability_definition_versions capability_version
JOIN public.capability_definitions capability
  ON capability.id=capability_version.capability_definition_id
WHERE capability.capability_key='procurement.purchase-order.mock-execute'
  AND capability_version.version='1.0.0'
ON CONFLICT (action_key,version) DO UPDATE
SET capability_version_id=EXCLUDED.capability_version_id;

CREATE FUNCTION workflow_private.compiled_binding_snapshot_is_current(
  p_company_id UUID,p_workflow_id UUID,p_binding_snapshot_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=''
AS $$
  SELECT workflow_private.compiled_binding_snapshot_is_safe(
    p_company_id,p_workflow_id,p_binding_snapshot_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.workflow_binding_snapshot_events event
    WHERE event.company_id=p_company_id
      AND event.binding_snapshot_id=p_binding_snapshot_id
      AND event.event_type='invalidated'
  )
  AND EXISTS (
    SELECT 1
    FROM public.workflow_capability_bindings binding
    WHERE binding.company_id=p_company_id
      AND binding.binding_snapshot_id=p_binding_snapshot_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.workflow_capability_bindings binding
    LEFT JOIN public.company_connector_capability_grants grant_record
      ON grant_record.id=binding.grant_id
     AND grant_record.company_id=binding.company_id
     AND grant_record.capability_version_id=binding.capability_version_id
    LEFT JOIN public.company_connector_installations installation
      ON installation.id=grant_record.installation_id
     AND installation.company_id=grant_record.company_id
    LEFT JOIN public.company_connector_health health
      ON health.installation_id=installation.id
     AND health.company_id=installation.company_id
    LEFT JOIN public.connector_definition_versions connector_version
      ON connector_version.id=installation.connector_version_id
    LEFT JOIN public.company_capability_policies policy
      ON policy.company_id=binding.company_id
     AND policy.capability_version_id=binding.capability_version_id
    WHERE binding.company_id=p_company_id
      AND binding.binding_snapshot_id=p_binding_snapshot_id
      AND (
        grant_record.id IS NULL
        OR grant_record.status<>'active'
        OR installation.status<>'connected'
        OR health.status<>'healthy'
        OR health.observed_schema_hash IS DISTINCT FROM connector_version.schema_hash
        OR policy.enabled IS DISTINCT FROM true
      )
  )
$$;

REVOKE ALL ON FUNCTION workflow_private.compiled_binding_snapshot_is_current(UUID,UUID,UUID)
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION workflow_private.guard_registered_agent_action_attempt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  definition public.agent_action_definitions%ROWTYPE;
  target_run public.workflow_runs%ROWTYPE;
  target_workflow public.agent_workflows%ROWTYPE;
  runtime_state public.agent_runtime_states%ROWTYPE;
BEGIN
  -- Direct maintenance and migration writes run without an end-user identity;
  -- all authenticated execution endpoints retain auth.uid() through their
  -- security-definer boundary and therefore take the strict path below.
  IF actor IS NULL THEN RETURN NEW; END IF;
  SELECT run.* INTO target_run FROM public.workflow_runs run
  WHERE run.id=NEW.workflow_run_id AND run.company_id=NEW.company_id;
  SELECT workflow.* INTO target_workflow FROM public.agent_workflows workflow
  WHERE workflow.id=target_run.workflow_id AND workflow.company_id=NEW.company_id;
  SELECT state.* INTO runtime_state FROM public.agent_runtime_states state
  WHERE state.company_id=NEW.company_id AND state.workflow_id=target_workflow.id
  FOR SHARE;
  IF runtime_state.id IS NULL AND target_workflow.skill_source_hash IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT row.* INTO definition FROM public.agent_action_definitions row
  WHERE row.action_key=NEW.action_type AND row.version='1.0.0' AND row.status='active'
    AND NEW.mode=ANY(row.allowed_modes);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'executor_not_registered' USING ERRCODE='55000';
  END IF;
  IF jsonb_typeof(COALESCE(NEW.request_payload,'null'::JSONB))<>'object' THEN
    RAISE EXCEPTION 'execution_input_invalid' USING ERRCODE='22023';
  END IF;
  IF runtime_state.id IS NOT NULL AND runtime_state.lifecycle_state<>'active' THEN
    RAISE EXCEPTION 'agent_not_active' USING ERRCODE='55000';
  END IF;
  IF target_workflow.skill_source_hash IS NOT NULL THEN
    IF runtime_state.id IS NULL THEN
      RAISE EXCEPTION 'agent_not_active' USING ERRCODE='55000';
    END IF;
    IF target_run.workflow_binding_snapshot_id IS NULL
      OR runtime_state.binding_snapshot_id IS DISTINCT FROM target_run.workflow_binding_snapshot_id
      OR definition.capability_version_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.workflow_capability_bindings binding
        WHERE binding.company_id=NEW.company_id
          AND binding.binding_snapshot_id=target_run.workflow_binding_snapshot_id
          AND binding.capability_version_id=definition.capability_version_id
      )
      OR NOT workflow_private.compiled_binding_snapshot_is_current(
        NEW.company_id,target_workflow.id,target_run.workflow_binding_snapshot_id
      )
    THEN
      RAISE EXCEPTION 'execution_context_stale' USING ERRCODE='55000';
    END IF;
  END IF;

  NEW.action_definition_id:=definition.id;
  NEW.retry_class:=definition.retry_class;
  NEW.request_hash:=COALESCE(NEW.request_hash,encode(
    extensions.digest(convert_to(NEW.request_payload::TEXT,'UTF8'),'sha256'),'hex'
  ));
  NEW.effect_state:=CASE WHEN NEW.status='processing' THEN 'none'
    WHEN NEW.mode IN ('fixture','mock','dry_run') THEN 'simulated'
    WHEN NEW.mode='shadow' THEN 'observed' ELSE NEW.effect_state END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_action_attempt_registered_agent_guard
BEFORE INSERT ON public.workflow_action_attempts
FOR EACH ROW EXECUTE FUNCTION workflow_private.guard_registered_agent_action_attempt();

CREATE FUNCTION workflow_private.record_registered_agent_execution_receipt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NEW.action_definition_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.agent_execution_receipts(
    company_id,action_attempt_id,receipt_sequence,status,effect_state,safe_output,
    failure_class,request_hash,response_hash,provider_idempotency_key,provider_reference
  ) VALUES (
    NEW.company_id,NEW.id,1,NEW.status,NEW.effect_state,
    CASE WHEN jsonb_typeof(NEW.result_payload)='object' THEN NEW.result_payload ELSE '{}'::JSONB END,
    CASE WHEN NEW.status='failed' THEN 'terminal' WHEN NEW.status='unknown' THEN 'outcome_unknown'
      WHEN NEW.status='reconciliation_required' THEN 'reconciliation_required' ELSE NULL END,
    NEW.request_hash,
    CASE WHEN NEW.result_payload IS NULL THEN NULL ELSE encode(
      extensions.digest(convert_to(NEW.result_payload::TEXT,'UTF8'),'sha256'),'hex'
    ) END,
    NEW.provider_idempotency_key,COALESCE(NEW.provider_reference,NEW.mock_external_id)
  ) ON CONFLICT (action_attempt_id,receipt_sequence) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_action_attempt_agent_receipt
AFTER INSERT ON public.workflow_action_attempts
FOR EACH ROW EXECUTE FUNCTION workflow_private.record_registered_agent_execution_receipt();

REVOKE ALL ON FUNCTION workflow_private.guard_registered_agent_action_attempt() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_registered_agent_execution_receipt() FROM PUBLIC,anon,authenticated;

-- Sandbox readiness is derived from durable run, review, evidence, current
-- bindings and evaluation rows. Clients may contribute extra blockers, but
-- cannot remove the server-derived blockers or manufacture a passing run.
CREATE FUNCTION workflow_private.record_agent_test_evaluation_payload(
  p_company_id UUID,p_workflow_id UUID,p_expected_version BIGINT,
  p_sample_run_id UUID,p_sample_item_id UUID,p_client_issues JSONB,
  p_evaluator_version TEXT,p_reason TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  target_workflow public.agent_workflows%ROWTYPE;
  target_run public.workflow_runs%ROWTYPE;
  target_item public.workflow_items%ROWTYPE;
  target_snapshot public.workflow_binding_snapshots%ROWTYPE;
  recommendation public.workflow_recommendation_runs%ROWTYPE;
  evidence public.workflow_evidence_snapshots%ROWTYPE;
  evaluation_case_id UUID;
  evaluation_run_id UUID := gen_random_uuid();
  server_issues JSONB := '[]'::JSONB;
  all_issues JSONB;
  metrics JSONB;
  threshold_decision TEXT;
  dataset_digest TEXT;
  evaluation_case_key TEXT;
  recommendation_version TEXT;
  safe_trace_ids JSONB := '[]'::JSONB;
  configured_thresholds JSONB := '{"reviewProduced":1,"evidencePresent":1,"safeMode":1}'::JSONB;
  readiness_hash TEXT;
  readiness_result JSONB;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id,'admin',actor);
  IF p_expected_version<1 OR p_evaluator_version!~'^\d+\.\d+\.\d+$'
    OR jsonb_typeof(COALESCE(p_client_issues,'null'::JSONB))<>'array'
    OR jsonb_array_length(p_client_issues)>100
    OR length(trim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 1000
  THEN RAISE EXCEPTION 'invalid_readiness_result' USING ERRCODE='22023'; END IF;

  SELECT workflow.* INTO target_workflow FROM public.agent_workflows workflow
  WHERE workflow.id=p_workflow_id AND workflow.company_id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow_not_found' USING ERRCODE='P0002'; END IF;
  SELECT run.* INTO target_run FROM public.workflow_runs run
  WHERE run.id=p_sample_run_id AND run.company_id=p_company_id AND run.workflow_id=p_workflow_id;
  IF NOT FOUND OR target_run.status<>'waiting_for_approval' THEN
    server_issues:=server_issues||jsonb_build_array(jsonb_build_object(
      'code','sample_run_failed','path','sampleRun','message','The Sandbox run did not reach human review.'
    ));
  END IF;
  SELECT item.* INTO target_item FROM public.workflow_items item
  WHERE item.id=p_sample_item_id AND item.company_id=p_company_id
    AND item.workflow_run_id=p_sample_run_id AND item.workflow_id=p_workflow_id;
  IF NOT FOUND THEN
    server_issues:=server_issues||jsonb_build_array(jsonb_build_object(
      'code','sample_run_failed','path','sampleRun.item','message','The Sandbox run did not create a review item.'
    ));
  END IF;
  SELECT row.* INTO recommendation FROM public.workflow_recommendation_runs row
  WHERE row.company_id=p_company_id AND row.workflow_run_id=p_sample_run_id
    AND row.workflow_item_id=p_sample_item_id AND row.status='ready_for_review'
  ORDER BY row.created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    server_issues:=server_issues||jsonb_build_array(jsonb_build_object(
      'code','evaluation_blocked','path','evaluation.recommendation','message','No review-ready recommendation was produced.'
    ));
  END IF;
  SELECT row.* INTO evidence FROM public.workflow_evidence_snapshots row
  WHERE row.company_id=p_company_id AND row.workflow_run_id=p_sample_run_id
    AND row.workflow_item_id=p_sample_item_id AND row.recommendation_run_id=recommendation.id
  ORDER BY row.created_at DESC LIMIT 1;
  IF NOT FOUND OR (
    jsonb_array_length(COALESCE(evidence.source_refs,'[]'::JSONB))=0
    AND jsonb_array_length(COALESCE(evidence.evidence,'[]'::JSONB))=0
  ) THEN
    server_issues:=server_issues||jsonb_build_array(jsonb_build_object(
      'code','sample_run_failed','path','sampleRun.evidence','message','The review item has no durable evidence.'
    ));
  END IF;

  SELECT snapshot.* INTO target_snapshot FROM public.workflow_binding_snapshots snapshot
  WHERE snapshot.company_id=p_company_id AND snapshot.workflow_id=p_workflow_id
    AND snapshot.manifest_hash=target_workflow.compiled_manifest_hash
    AND NOT EXISTS (SELECT 1 FROM public.workflow_binding_snapshot_events event
      WHERE event.company_id=p_company_id AND event.binding_snapshot_id=snapshot.id
        AND event.event_type='invalidated')
  ORDER BY snapshot.created_at DESC,snapshot.id DESC LIMIT 1;
  IF target_workflow.skill_source_hash IS NOT NULL AND (
    target_snapshot.id IS NULL OR target_run.workflow_binding_snapshot_id IS DISTINCT FROM target_snapshot.id
    OR NOT workflow_private.compiled_binding_snapshot_is_current(p_company_id,p_workflow_id,target_snapshot.id)
  ) THEN
    server_issues:=server_issues||jsonb_build_array(jsonb_build_object(
      'code','binding_stale','path','bindings','message','Capability bindings are missing, unhealthy, or changed.'
    ));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(target_workflow.spec->'actions','[]'::JSONB)) action
    WHERE action->>'mode'='live') THEN
    server_issues:=server_issues||jsonb_build_array(jsonb_build_object(
      'code','mode_unavailable','path','modes.live','message','Live mode is unavailable in Cycle 0.0.5.'
    ));
  END IF;

  all_issues:=p_client_issues||server_issues;
  threshold_decision:=CASE WHEN jsonb_array_length(all_issues)=0 THEN 'pass' ELSE 'blocked' END;
  dataset_digest:=encode(extensions.digest(
    convert_to(COALESCE(target_run.input,'{}'::JSONB)::TEXT,'UTF8'
  ),'sha256'),'hex');
  evaluation_case_key:='sandbox-review-'||p_workflow_id::TEXT||'-'||left(dataset_digest,16);
  recommendation_version:=CASE WHEN recommendation.id IS NULL THEN NULL
    ELSE workflow_private.workflow_review_version(p_company_id,p_sample_item_id) END;
  SELECT COALESCE(jsonb_agg(trace.trace_id ORDER BY trace.ordinality),'[]'::JSONB)
  INTO safe_trace_ids
  FROM unnest(ARRAY[recommendation.langsmith_trace_id,recommendation.langsmith_run_id])
    WITH ORDINALITY AS trace(trace_id,ordinality)
  WHERE trace.trace_id IS NOT NULL AND length(trace.trace_id) BETWEEN 1 AND 200;
  metrics:=jsonb_build_object(
    'reviewProduced',CASE WHEN target_item.id IS NULL THEN 0 ELSE 1 END,
    'evidencePresent',CASE WHEN evidence.id IS NULL THEN 0 ELSE 1 END,
    'safeMode',CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(target_workflow.spec->'actions','[]'::JSONB)) action WHERE action->>'mode'='live') THEN 0 ELSE 1 END,
    'confidenceExplanation','Promotion uses durable review, evidence, binding, and safe-mode checks; it is not model self-confidence.'
  );
  INSERT INTO public.agent_evaluation_cases(
    company_id,case_key,version,fixture,input_digest,evidence_digest,missing_data_state,created_by
  ) VALUES (
    p_company_id,evaluation_case_key,target_workflow.version,
    jsonb_build_object('workflowId',p_workflow_id,'workflowRunId',p_sample_run_id,'itemId',p_sample_item_id),
    dataset_digest,
    CASE WHEN evidence.id IS NULL THEN NULL ELSE encode(extensions.digest(convert_to(evidence.id::TEXT||evidence.source_refs::TEXT||evidence.evidence::TEXT,'UTF8'),'sha256'),'hex') END,
    CASE WHEN evidence.id IS NULL THEN 'unavailable' WHEN threshold_decision='pass' THEN 'complete' ELSE 'partial' END,actor
  ) ON CONFLICT (company_id,case_key,version) DO NOTHING;
  SELECT id INTO evaluation_case_id FROM public.agent_evaluation_cases
  WHERE company_id=p_company_id AND case_key=evaluation_case_key AND version=target_workflow.version;
  INSERT INTO public.agent_evaluation_runs(
    id,company_id,evaluation_case_id,workflow_id,workflow_run_id,recommendation_run_id,
    recommendation_version,manifest_digest,dataset_digest,evaluator_version,
    confidence_definition_version,safe_trace_ids,metrics,missing_data,threshold_decision
  ) VALUES (
    evaluation_run_id,p_company_id,evaluation_case_id,p_workflow_id,p_sample_run_id,recommendation.id,
    recommendation_version,
    COALESCE(target_workflow.compiled_manifest_hash,repeat('0',64)),
    dataset_digest,
    p_evaluator_version,'1.0.0',safe_trace_ids,metrics,server_issues,threshold_decision
  );
  IF threshold_decision='pass' THEN
    INSERT INTO public.agent_promotion_checkpoints(
      company_id,workflow_id,workflow_version,evaluation_run_id,thresholds,decision,reason
    ) VALUES (
      p_company_id,p_workflow_id,target_workflow.version,evaluation_run_id,
      configured_thresholds,'pass',
      'Sandbox evaluation passed all server-owned promotion thresholds.'
    ) ON CONFLICT DO NOTHING;
  END IF;
  readiness_hash:=encode(extensions.digest(convert_to(
    COALESCE(target_workflow.compiled_manifest_hash,target_workflow.skill_source_hash,'')||':'||
    p_sample_run_id::TEXT||':'||evaluation_run_id::TEXT||':'||all_issues::TEXT,'UTF8'
  ),'sha256'),'hex');
  readiness_result:=workflow_private.record_agent_readiness(
    p_company_id,p_workflow_id,p_expected_version,readiness_hash,all_issues,p_sample_run_id,trim(p_reason)
  );
  RETURN readiness_result||jsonb_build_object(
    'evaluationRunId',evaluation_run_id,'promotionDecision',threshold_decision,'metrics',metrics
  );
END;
$$;

CREATE FUNCTION public.record_agent_test_evaluation_v1(
  p_company_id UUID,p_workflow_id UUID,p_expected_version BIGINT,
  p_sample_run_id UUID,p_sample_item_id UUID,p_client_issues JSONB DEFAULT '[]'::JSONB,
  p_evaluator_version TEXT DEFAULT '1.0.0',p_reason TEXT DEFAULT 'Sandbox readiness evaluated.'
)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT workflow_private.record_agent_test_evaluation_payload($1,$2,$3,$4,$5,$6,$7,$8) $$;

REVOKE EXECUTE ON FUNCTION public.record_agent_readiness_v1(UUID,UUID,BIGINT,TEXT,JSONB,UUID,TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_agent_test_evaluation_payload(UUID,UUID,BIGINT,UUID,UUID,JSONB,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.record_agent_test_evaluation_v1(UUID,UUID,BIGINT,UUID,UUID,JSONB,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_agent_test_evaluation_v1(UUID,UUID,BIGINT,UUID,UUID,JSONB,TEXT,TEXT) TO authenticated;

CREATE FUNCTION workflow_private.require_agent_promotion_checkpoint()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.agent_runtime_states state
    WHERE state.company_id=NEW.company_id AND state.workflow_id=NEW.workflow_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.agent_promotion_checkpoints checkpoint
      JOIN public.agent_workflows workflow ON workflow.id=checkpoint.workflow_id AND workflow.company_id=checkpoint.company_id
      WHERE checkpoint.company_id=NEW.company_id AND checkpoint.workflow_id=NEW.workflow_id
        AND checkpoint.workflow_version=workflow.version AND checkpoint.decision='pass'
    )
  THEN RAISE EXCEPTION 'promotion_checkpoint_blocked' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_activations_agent_promotion_guard
BEFORE INSERT OR UPDATE OF workflow_id,binding_snapshot_id ON public.workflow_activations
FOR EACH ROW EXECUTE FUNCTION workflow_private.require_agent_promotion_checkpoint();
REVOKE ALL ON FUNCTION workflow_private.require_agent_promotion_checkpoint() FROM PUBLIC,anon,authenticated;

-- Legacy activation endpoints remain available for pre-runtime workflows, but
-- cannot bypass expected-version lifecycle transitions once a 0.0.5 runtime
-- state exists.
CREATE OR REPLACE FUNCTION public.activate_agent_workflow(
  p_company_id UUID,p_workflow_id UUID,p_binding_snapshot_id UUID,
  p_expected_current_workflow_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE actor UUID := (SELECT auth.uid());
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id,'admin',actor);
  IF EXISTS (SELECT 1 FROM public.agent_runtime_states state
    WHERE state.company_id=p_company_id AND state.workflow_id=p_workflow_id)
  THEN
    RAISE EXCEPTION 'lifecycle_transition_requires_expected_version' USING ERRCODE='55000';
  END IF;
  RETURN workflow_private.transition_workflow_activation(
    p_company_id,p_workflow_id,p_binding_snapshot_id,
    p_expected_current_workflow_id,'activated'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_agent_workflow(
  p_company_id UUID,p_workflow_key TEXT,p_expected_current_workflow_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  current_activation public.workflow_activations%ROWTYPE;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id,'admin',actor);
  IF EXISTS (SELECT 1 FROM public.agent_runtime_states state
    WHERE state.company_id=p_company_id AND state.workflow_id=p_expected_current_workflow_id)
  THEN
    RAISE EXCEPTION 'lifecycle_transition_requires_expected_version' USING ERRCODE='55000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_company_id::TEXT||':'||p_workflow_key,0));
  SELECT activation.* INTO current_activation FROM public.workflow_activations activation
  WHERE activation.company_id=p_company_id AND activation.workflow_key=p_workflow_key FOR UPDATE;
  IF current_activation.workflow_id IS NULL THEN
    RAISE EXCEPTION 'workflow_not_active' USING ERRCODE='P0002';
  END IF;
  IF current_activation.workflow_id IS DISTINCT FROM p_expected_current_workflow_id THEN
    RAISE EXCEPTION 'stale_workflow_activation' USING ERRCODE='40001';
  END IF;
  DELETE FROM public.workflow_activations activation
  WHERE activation.company_id=p_company_id AND activation.workflow_key=p_workflow_key;
  INSERT INTO public.workflow_activation_events(
    company_id,workflow_key,workflow_id,binding_snapshot_id,previous_workflow_id,event_type,actor_id
  ) VALUES (
    p_company_id,p_workflow_key,current_activation.workflow_id,current_activation.binding_snapshot_id,
    current_activation.workflow_id,'deactivated',actor
  );
  PERFORM workflow_private.record_company_security_audit(
    p_company_id,'workflow_deactivated','Workflow deactivated.',jsonb_build_object(
      'workflowKey',p_workflow_key,'workflowId',current_activation.workflow_id,
      'bindingSnapshotId',current_activation.binding_snapshot_id,
      'activationSequence',current_activation.activation_sequence
    )
  );
  RETURN jsonb_build_object(
    'workflowKey',p_workflow_key,'workflowId',current_activation.workflow_id,'eventType','deactivated'
  );
END;
$$;

CREATE FUNCTION public.rollback_agent_workflow(
  p_company_id UUID,p_workflow_id UUID,p_binding_snapshot_id UUID,
  p_expected_current_workflow_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE actor UUID := (SELECT auth.uid());
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id,'admin',actor);
  IF EXISTS (SELECT 1 FROM public.agent_runtime_states state
    WHERE state.company_id=p_company_id
      AND state.workflow_id IN (p_workflow_id,p_expected_current_workflow_id))
  THEN
    RAISE EXCEPTION 'lifecycle_transition_requires_expected_version' USING ERRCODE='55000';
  END IF;
  RETURN workflow_private.transition_workflow_activation(
    p_company_id,p_workflow_id,p_binding_snapshot_id,
    p_expected_current_workflow_id,'rolled_back'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.rollback_agent_workflow(UUID,UUID,UUID,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rollback_agent_workflow(UUID,UUID,UUID,UUID) TO authenticated;

-- Resolve and execute non-live skill actions through the generic registry
-- dispatcher. These functions expose only bounded execution metadata; raw
-- connector credentials and unrestricted provider operations never cross the
-- boundary.
CREATE FUNCTION workflow_private.registered_agent_execution_context(
  p_company_id UUID,p_action_draft_id UUID,p_decision_id UUID
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  draft public.workflow_action_drafts%ROWTYPE;
  run public.workflow_runs%ROWTYPE;
  workflow public.agent_workflows%ROWTYPE;
  state public.agent_runtime_states%ROWTYPE;
  decision public.workflow_decisions%ROWTYPE;
  action_record JSONB;
  capability_record JSONB;
  definition public.agent_action_definitions%ROWTYPE;
  capability_binding public.workflow_capability_bindings%ROWTYPE;
  capability_version public.capability_definition_versions%ROWTYPE;
  grant_record public.company_connector_capability_grants%ROWTYPE;
  installation public.company_connector_installations%ROWTYPE;
  health public.company_connector_health%ROWTYPE;
  connector_version public.connector_definition_versions%ROWTYPE;
  policy public.company_capability_policies%ROWTYPE;
  execution_mode TEXT;
  fixture_origin BOOLEAN;
  minimum_role TEXT := 'approver';
  agent_config_version BIGINT := 1;
  policy_version BIGINT := 1;
  binding_version BIGINT := 1;
  binding_current BOOLEAN := false;
BEGIN
  SELECT row.* INTO draft FROM public.workflow_action_drafts row
  WHERE row.id=p_action_draft_id AND row.company_id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'draft_not_found' USING ERRCODE='P0002'; END IF;
  SELECT row.* INTO run FROM public.workflow_runs row
  WHERE row.id=draft.workflow_run_id AND row.company_id=p_company_id;
  SELECT row.* INTO workflow FROM public.agent_workflows row
  WHERE row.id=run.workflow_id AND row.company_id=p_company_id;
  SELECT candidate.minimum_role INTO minimum_role FROM public.company_approval_policies candidate
  WHERE candidate.company_id=p_company_id AND candidate.workflow_type=run.workflow_type
    AND candidate.action_type=draft.action_type;
  IF COALESCE((SELECT auth.jwt()->>'role'),'')<>'service_role' THEN
    PERFORM workflow_private.require_company_role(p_company_id,COALESCE(minimum_role,'approver'),actor);
  END IF;

  IF workflow.skill_source_hash IS NULL THEN
    RETURN jsonb_build_object('kind','legacy');
  END IF;
  SELECT candidate INTO action_record FROM jsonb_array_elements(COALESCE(workflow.spec->'actions','[]'::JSONB)) candidate
  WHERE candidate->>'id'=draft.action_type;
  IF action_record IS NULL THEN RAISE EXCEPTION 'executor_not_registered' USING ERRCODE='55000'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.workflow_events event
    WHERE event.company_id=p_company_id AND event.workflow_run_id=run.id AND event.origin='fixture')
  INTO fixture_origin;
  execution_mode:=CASE
    WHEN fixture_origin AND action_record->>'mode'='mock' THEN 'fixture'
    ELSE action_record->>'mode'
  END;
  IF execution_mode='mock' THEN RETURN jsonb_build_object('kind','legacy'); END IF;
  IF execution_mode NOT IN ('fixture','dry_run','shadow') THEN
    RAISE EXCEPTION 'execution_mode_not_allowed' USING ERRCODE='55000';
  END IF;
  SELECT candidate INTO capability_record FROM jsonb_array_elements(COALESCE(workflow.spec->'capabilityBindings','[]'::JSONB)) candidate
  WHERE candidate->>'id'=action_record->>'capability';
  IF capability_record IS NULL OR capability_record->>'access'='read' THEN
    RAISE EXCEPTION 'capability_not_granted' USING ERRCODE='55000';
  END IF;
  SELECT row.* INTO capability_binding FROM public.workflow_capability_bindings row
  WHERE row.company_id=p_company_id AND row.binding_snapshot_id=run.workflow_binding_snapshot_id
    AND row.requirement_key=capability_record->>'alias';
  SELECT row.* INTO capability_version FROM public.capability_definition_versions row
  WHERE row.id=capability_binding.capability_version_id;
  SELECT row.* INTO definition FROM public.agent_action_definitions row
  WHERE row.action_key=draft.action_type AND row.version='1.0.0' AND row.status='active'
    AND row.capability_version_id=capability_binding.capability_version_id
    AND execution_mode=ANY(row.allowed_modes);
  IF NOT FOUND THEN RAISE EXCEPTION 'executor_not_registered' USING ERRCODE='55000'; END IF;

  SELECT row.* INTO state FROM public.agent_runtime_states row
  WHERE row.company_id=p_company_id AND row.workflow_id=workflow.id;
  SELECT row.* INTO decision FROM public.workflow_decisions row
  WHERE row.id=p_decision_id AND row.company_id=p_company_id
    AND row.action_draft_id=draft.id AND row.decision IN ('approve','edit');
  SELECT row.* INTO grant_record FROM public.company_connector_capability_grants row
  WHERE row.id=capability_binding.grant_id AND row.company_id=p_company_id
    AND row.capability_version_id=capability_binding.capability_version_id;
  SELECT row.* INTO installation FROM public.company_connector_installations row
  WHERE row.id=grant_record.installation_id AND row.company_id=p_company_id;
  SELECT row.* INTO health FROM public.company_connector_health row
  WHERE row.installation_id=installation.id AND row.company_id=p_company_id;
  SELECT row.* INTO connector_version FROM public.connector_definition_versions row
  WHERE row.id=installation.connector_version_id;
  SELECT row.* INTO policy FROM public.company_capability_policies row
  WHERE row.company_id=p_company_id AND row.capability_version_id=capability_binding.capability_version_id;
  SELECT COALESCE(activation.activation_sequence,1) INTO binding_version
  FROM public.workflow_activations activation
  WHERE activation.company_id=p_company_id AND activation.workflow_id=workflow.id;
  binding_version:=COALESCE(binding_version,1);
  agent_config_version:=GREATEST(1,(extract(epoch FROM workflow.updated_at)*1000000)::BIGINT);
  policy_version:=GREATEST(1,(extract(epoch FROM policy.updated_at)*1000000)::BIGINT);
  binding_current:=workflow_private.compiled_binding_snapshot_is_current(
    p_company_id,workflow.id,run.workflow_binding_snapshot_id
  );

  RETURN jsonb_build_object(
    'kind','registered','companyId',p_company_id,'agentId',workflow.id,
    'workflowRunId',run.id,'itemId',draft.workflow_item_id,'actionDraftId',draft.id,
    'decisionId',p_decision_id,'actionId',draft.action_type,'actionVersion',definition.version,
    'capabilityId',capability_record->>'id','capabilityVersion',capability_record->>'version',
    'connectorId',capability_record->>'connectorId','schemaDigest',capability_record->>'schemaDigest',
    'mode',execution_mode,'allowedModes',to_jsonb(definition.allowed_modes),
    'timeoutMs',definition.timeout_ms,'retryClass',definition.retry_class,
    'inputSchema',definition.input_schema,'outputSchema',definition.output_schema,
    'input',draft.payload,'approvalId',decision.id,
    'expected',jsonb_build_object(
      'agentConfigVersion',agent_config_version,
      'lifecycleVersion',COALESCE(state.state_version,1),
      'policyVersion',policy_version,
      'bindingVersion',binding_version
    ),
    'policy',jsonb_build_object(
      'allowed',state.lifecycle_state='active' AND decision.id IS NOT NULL AND policy.enabled IS TRUE
        AND grant_record.status='active' AND installation.status='connected' AND health.status='healthy'
        AND health.observed_schema_hash=connector_version.schema_hash
        AND capability_version.version=capability_record->>'version'
        AND capability_version.schema_hash=capability_record->>'schemaDigest'
        AND installation.id::TEXT=capability_record->>'connectorId'
        AND binding_current,
      'reason',CASE WHEN state.lifecycle_state<>'active' THEN 'agent_not_active'
        WHEN decision.id IS NULL THEN 'approval_invalid'
        WHEN NOT binding_current THEN 'execution_context_stale'
        WHEN policy.enabled IS DISTINCT FROM TRUE THEN 'policy_denied' ELSE NULL END,
      'lifecycleState',COALESCE(state.lifecycle_state,'draft'),
      'agentConfigVersion',agent_config_version,
      'lifecycleVersion',COALESCE(state.state_version,1),
      'policyVersion',policy_version,
      'bindingVersion',binding_version,
      'capabilityGranted',grant_record.status='active' AND policy.enabled IS TRUE
        AND capability_version.version=capability_record->>'version'
        AND capability_version.schema_hash=capability_record->>'schemaDigest'
        AND installation.id::TEXT=capability_record->>'connectorId',
      'connectorHealthy',installation.status='connected' AND health.status='healthy'
        AND health.observed_schema_hash=connector_version.schema_hash,
      'approvalValid',decision.id IS NOT NULL
    )
  );
END;
$$;

CREATE FUNCTION public.get_registered_agent_execution_context_v1(
  p_company_id UUID,p_action_draft_id UUID,p_decision_id UUID
)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT workflow_private.registered_agent_execution_context($1,$2,$3) $$;

CREATE FUNCTION workflow_private.begin_registered_agent_execution(
  p_company_id UUID,p_action_draft_id UUID,p_decision_id UUID,p_raw_token TEXT,
  p_idempotency_key TEXT,p_request_hash TEXT,p_mode TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  context JSONB;
  draft public.workflow_action_drafts%ROWTYPE;
  token public.workflow_execution_tokens%ROWTYPE;
  attempt public.workflow_action_attempts%ROWTYPE;
  expected_token_hash TEXT;
  payload_hash TEXT;
BEGIN
  context:=workflow_private.registered_agent_execution_context(p_company_id,p_action_draft_id,p_decision_id);
  IF context->>'kind'<>'registered' OR context->>'mode' IS DISTINCT FROM p_mode
    OR p_request_hash!~'^[a-f0-9]{64}$'
    OR p_idempotency_key!~'^(cli|web|api):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid_execution_request' USING ERRCODE='22023';
  END IF;
  IF COALESCE((context #>> '{policy,allowed}')::BOOLEAN,false) IS NOT TRUE
    OR COALESCE((context #>> '{policy,capabilityGranted}')::BOOLEAN,false) IS NOT TRUE
    OR COALESCE((context #>> '{policy,connectorHealthy}')::BOOLEAN,false) IS NOT TRUE
    OR COALESCE((context #>> '{policy,approvalValid}')::BOOLEAN,false) IS NOT TRUE
  THEN RAISE EXCEPTION '%',COALESCE(context #>> '{policy,reason}','policy_denied') USING ERRCODE='55000'; END IF;
  SELECT row.* INTO draft FROM public.workflow_action_drafts row
  WHERE row.id=p_action_draft_id AND row.company_id=p_company_id FOR UPDATE;
  SELECT row.* INTO attempt FROM public.workflow_action_attempts row
  WHERE row.company_id=p_company_id AND row.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF attempt.action_draft_id<>p_action_draft_id OR attempt.decision_id<>p_decision_id
      OR attempt.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object(
      'kind',CASE WHEN attempt.status='processing' THEN 'in_progress' ELSE 'replay' END,
      'executionId',attempt.id,'attempt',to_jsonb(attempt),
      'draft',to_jsonb(draft),
      'item',(SELECT to_jsonb(item) FROM public.workflow_items item WHERE item.id=attempt.workflow_item_id AND item.company_id=p_company_id)
    );
  END IF;
  IF draft.status<>'approved' THEN RAISE EXCEPTION 'invalid_state' USING ERRCODE='55000'; END IF;
  expected_token_hash:=encode(extensions.digest(convert_to(p_raw_token,'UTF8'),'sha256'),'hex');
  SELECT row.* INTO token FROM public.workflow_execution_tokens row
  WHERE row.company_id=p_company_id AND row.action_draft_id=draft.id
    AND row.action_type=draft.action_type AND row.token_hash=expected_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'token_not_found' USING ERRCODE='P0002'; END IF;
  IF token.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'token_consumed' USING ERRCODE='55000'; END IF;
  IF token.expires_at<=now() THEN RAISE EXCEPTION 'token_expired' USING ERRCODE='55000'; END IF;
  payload_hash:=encode(extensions.digest(convert_to(draft.payload::TEXT,'UTF8'),'sha256'),'hex');
  IF payload_hash<>draft.payload_hash OR payload_hash<>token.payload_hash THEN
    RAISE EXCEPTION 'payload_hash_mismatch' USING ERRCODE='22023';
  END IF;
  UPDATE public.workflow_execution_tokens SET consumed_at=now()
  WHERE id=token.id AND company_id=p_company_id AND consumed_at IS NULL;
  INSERT INTO public.workflow_action_attempts(
    company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,
    idempotency_key,action_type,mode,status,request_payload,result_payload,request_hash,effect_state
  ) VALUES (
    p_company_id,draft.workflow_run_id,draft.workflow_item_id,draft.id,p_decision_id,token.id,
    p_idempotency_key,draft.action_type,p_mode,'processing',draft.payload,'{}',p_request_hash,'none'
  ) RETURNING * INTO attempt;
  RETURN jsonb_build_object('kind','started','executionId',attempt.id);
END;
$$;

CREATE FUNCTION public.begin_registered_agent_execution_v1(
  p_company_id UUID,p_action_draft_id UUID,p_decision_id UUID,p_raw_token TEXT,
  p_idempotency_key TEXT,p_request_hash TEXT,p_mode TEXT
)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT workflow_private.begin_registered_agent_execution($1,$2,$3,$4,$5,$6,$7) $$;

CREATE FUNCTION workflow_private.complete_registered_agent_execution(
  p_company_id UUID,p_execution_id UUID,p_idempotency_key TEXT,p_request_hash TEXT,p_result JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE
  attempt public.workflow_action_attempts%ROWTYPE;
  draft public.workflow_action_drafts%ROWTYPE;
  item public.workflow_items%ROWTYPE;
  final_status TEXT;
  succeeded BOOLEAN;
  safe_output JSONB;
  computed_response_hash TEXT;
  current_context JSONB;
BEGIN
  PERFORM workflow_private.require_service_role();
  SELECT row.* INTO attempt FROM public.workflow_action_attempts row
  WHERE row.id=p_execution_id AND row.company_id=p_company_id
    AND row.idempotency_key=p_idempotency_key AND row.request_hash=p_request_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'execution_receipt_not_found' USING ERRCODE='P0002'; END IF;
  SELECT row.* INTO draft FROM public.workflow_action_drafts row
  WHERE row.id=attempt.action_draft_id AND row.company_id=p_company_id FOR UPDATE;
  SELECT row.* INTO item FROM public.workflow_items row
  WHERE row.id=attempt.workflow_item_id AND row.company_id=p_company_id FOR UPDATE;
  current_context:=workflow_private.registered_agent_execution_context(
    p_company_id,attempt.action_draft_id,attempt.decision_id
  );
  IF COALESCE((current_context #>> '{policy,allowed}')::BOOLEAN,false) IS NOT TRUE
    OR COALESCE((current_context #>> '{policy,capabilityGranted}')::BOOLEAN,false) IS NOT TRUE
    OR COALESCE((current_context #>> '{policy,connectorHealthy}')::BOOLEAN,false) IS NOT TRUE
    OR COALESCE((current_context #>> '{policy,approvalValid}')::BOOLEAN,false) IS NOT TRUE
  THEN RAISE EXCEPTION '%',COALESCE(current_context #>> '{policy,reason}','policy_denied') USING ERRCODE='55000'; END IF;
  final_status:=p_result->>'status';
  succeeded:=final_status='succeeded';
  IF final_status NOT IN ('succeeded','failed','unknown','reconciliation_required') THEN
    RAISE EXCEPTION 'invalid_execution_result' USING ERRCODE='22023';
  END IF;
  safe_output:=CASE WHEN succeeded THEN jsonb_build_object(
    'input',attempt.request_payload,'mode',attempt.mode,'simulated',true
  ) ELSE '{}'::JSONB END;
  computed_response_hash:=CASE WHEN succeeded THEN encode(extensions.digest(convert_to(safe_output::TEXT,'UTF8'),'sha256'),'hex') ELSE NULL END;
  UPDATE public.workflow_action_attempts SET
    status=final_status,
    result_payload=safe_output,response_hash=computed_response_hash,
    effect_state=CASE WHEN final_status IN ('unknown','reconciliation_required') THEN 'unknown'
      WHEN NOT succeeded THEN 'none'
      WHEN attempt.mode='shadow' THEN 'observed' ELSE 'simulated' END,
    reconciliation_required=final_status IN ('unknown','reconciliation_required'),
    completed_at=now()
  WHERE id=attempt.id RETURNING * INTO attempt;
  INSERT INTO public.agent_execution_receipts(
    company_id,action_attempt_id,receipt_sequence,status,effect_state,safe_output,
    failure_class,request_hash,response_hash
  ) VALUES (
    p_company_id,attempt.id,2,attempt.status,attempt.effect_state,safe_output,
    CASE WHEN succeeded THEN NULL WHEN final_status='unknown' THEN 'outcome_unknown'
      WHEN final_status='reconciliation_required' THEN 'reconciliation_required' ELSE 'terminal' END,
    p_request_hash,computed_response_hash
  );
  IF succeeded THEN
    UPDATE public.workflow_action_drafts SET status='executed',updated_at=now()
    WHERE id=draft.id AND company_id=p_company_id RETURNING * INTO draft;
    UPDATE public.workflow_items SET status='executed',updated_at=now()
    WHERE id=item.id AND company_id=p_company_id RETURNING * INTO item;
    UPDATE public.workflow_runs SET status='executed',completed_at=now()
    WHERE id=attempt.workflow_run_id AND company_id=p_company_id;
  END IF;
  RETURN jsonb_build_object('attempt',to_jsonb(attempt),'draft',to_jsonb(draft),'item',to_jsonb(item),'duplicate',false);
END;
$$;

CREATE FUNCTION public.complete_registered_agent_execution_v1(
  p_company_id UUID,p_execution_id UUID,p_idempotency_key TEXT,p_request_hash TEXT,p_result JSONB
)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=''
AS $$ SELECT workflow_private.complete_registered_agent_execution($1,$2,$3,$4,$5) $$;

REVOKE ALL ON FUNCTION workflow_private.registered_agent_execution_context(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.begin_registered_agent_execution(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION workflow_private.complete_registered_agent_execution(UUID,UUID,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_registered_agent_execution_context_v1(UUID,UUID,UUID) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.begin_registered_agent_execution_v1(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.complete_registered_agent_execution_v1(UUID,UUID,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_registered_agent_execution_context_v1(UUID,UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_registered_agent_execution_v1(UUID,UUID,UUID,TEXT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_registered_agent_execution_v1(UUID,UUID,TEXT,TEXT,JSONB) TO service_role;
