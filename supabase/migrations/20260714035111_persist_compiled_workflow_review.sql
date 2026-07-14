-- Sandbox persistence for a compiled, immutable workflow version.
--
-- This deliberately does not share or weaken the fixture adapter path. A
-- supplied binding snapshot allows an owner/admin to test an installed draft
-- before activation while preserving the same durable review graph used by
-- production workflows.

CREATE TABLE workflow_private.compiled_workflow_persistence_receipts (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  input_hash TEXT NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  client_surface TEXT NOT NULL
    CHECK (client_surface IN ('cli', 'web', 'api', 'automation')),
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  workflow_id UUID NOT NULL,
  binding_snapshot_id UUID NOT NULL,
  workflow_run_id UUID NOT NULL,
  workflow_item_id UUID,
  action_draft_id UUID,
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, actor_id, input_hash),
  UNIQUE (company_id, workflow_run_id),
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (binding_snapshot_id, company_id, workflow_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id, workflow_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (workflow_run_id, company_id)
    REFERENCES public.workflow_runs(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_item_id, company_id)
    REFERENCES public.workflow_items(id, company_id) ON DELETE RESTRICT,
  FOREIGN KEY (action_draft_id, company_id)
    REFERENCES public.workflow_action_drafts(id, company_id) ON DELETE RESTRICT
);

REVOKE ALL ON TABLE workflow_private.compiled_workflow_persistence_receipts
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION workflow_private.jsonb_object_has_exact_keys(
  p_value JSONB,
  p_keys TEXT[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(p_value) = 'object'
    AND p_value ?& p_keys
    AND p_value - p_keys = '{}'::JSONB
$$;

CREATE FUNCTION workflow_private.compiled_binding_snapshot_is_safe(
  p_company_id UUID,
  p_workflow_id UUID,
  p_binding_snapshot_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_workflow public.agent_workflows%ROWTYPE;
  manifest JSONB;
BEGIN
  SELECT workflow.*
  INTO target_workflow
  FROM public.agent_workflows workflow
  WHERE workflow.id = p_workflow_id
    AND workflow.company_id = p_company_id;

  IF NOT FOUND OR target_workflow.skill_source_hash IS NULL THEN
    RETURN false;
  END IF;
  manifest := target_workflow.spec;

  IF manifest ->> 'schemaVersion' IS DISTINCT FROM 'mandala.ai/v1'
    OR manifest ->> 'compilerVersion' IS DISTINCT FROM target_workflow.compiler_version
    OR jsonb_typeof(manifest -> 'capabilityBindings') <> 'array'
    OR jsonb_typeof(manifest -> 'actions') <> 'array'
    OR jsonb_typeof(manifest -> 'approvals') <> 'array'
    OR jsonb_typeof(manifest -> 'records') <> 'object'
    OR NOT EXISTS (
      SELECT 1
      FROM public.workflow_binding_snapshots snapshot
      WHERE snapshot.id = p_binding_snapshot_id
        AND snapshot.company_id = p_company_id
        AND snapshot.workflow_id = p_workflow_id
        AND snapshot.manifest_hash = target_workflow.compiled_manifest_hash
    )
  THEN
    RETURN false;
  END IF;

  -- Every manifest alias must resolve to exactly the versioned capability in
  -- the immutable database snapshot. Caller-supplied compiler success cannot
  -- manufacture a permission that was not granted by an admin.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(manifest -> 'capabilityBindings') manifest_binding
    WHERE manifest_binding ->> 'alias' !~ '^[a-z0-9][a-z0-9._-]{0,149}$'
      OR manifest_binding ->> 'id' !~ '^[a-z0-9][a-z0-9._-]{2,149}$'
      OR manifest_binding ->> 'version' !~ '^\d+\.\d+\.\d+$'
      OR manifest_binding ->> 'access' NOT IN ('read', 'propose', 'execute')
      OR NOT EXISTS (
        SELECT 1
        FROM public.workflow_capability_bindings binding
        JOIN public.capability_definition_versions capability_version
          ON capability_version.id = binding.capability_version_id
        JOIN public.capability_definitions capability
          ON capability.id = capability_version.capability_definition_id
        WHERE binding.company_id = p_company_id
          AND binding.binding_snapshot_id = p_binding_snapshot_id
          AND binding.requirement_key = manifest_binding ->> 'alias'
          AND capability.capability_key = manifest_binding ->> 'id'
          AND capability_version.version = manifest_binding ->> 'version'
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.workflow_capability_bindings binding
    JOIN public.capability_definition_versions capability_version
      ON capability_version.id = binding.capability_version_id
    JOIN public.capability_definitions capability
      ON capability.id = capability_version.capability_definition_id
    WHERE binding.company_id = p_company_id
      AND binding.binding_snapshot_id = p_binding_snapshot_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(manifest -> 'capabilityBindings') manifest_binding
        WHERE manifest_binding ->> 'alias' = binding.requirement_key
          AND manifest_binding ->> 'id' = capability.capability_key
          AND manifest_binding ->> 'version' = capability_version.version
      )
  ) THEN
    RETURN false;
  END IF;

  -- Every executable action must be reachable through its declared snapshot
  -- binding and remain human-gated. The current release rejects live-write
  -- capabilities even if an admin spoofs a successful compiler result.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(manifest -> 'actions') action_record
    WHERE action_record ->> 'id' !~ '^[a-z0-9][a-z0-9._-]{0,149}$'
      OR action_record ->> 'mode' NOT IN ('mock', 'dry_run', 'shadow')
      OR COALESCE((action_record ->> 'requires_approval')::BOOLEAN, false) IS NOT true
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(manifest -> 'approvals') approval_record
        WHERE approval_record ->> 'action' = action_record ->> 'id'
          AND COALESCE((approval_record ->> 'human_required')::BOOLEAN, false)
      )
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(manifest -> 'capabilityBindings') manifest_binding
        JOIN public.workflow_capability_bindings binding
          ON binding.company_id = p_company_id
         AND binding.binding_snapshot_id = p_binding_snapshot_id
         AND binding.requirement_key = manifest_binding ->> 'alias'
        JOIN public.capability_definition_versions capability_version
          ON capability_version.id = binding.capability_version_id
        JOIN public.capability_definitions capability
          ON capability.id = capability_version.capability_definition_id
        WHERE manifest_binding ->> 'id' = action_record ->> 'capability'
          AND manifest_binding ->> 'access' IN ('propose', 'execute')
          AND capability.capability_key = manifest_binding ->> 'id'
          AND capability_version.version = manifest_binding ->> 'version'
          AND capability.effect IN ('propose', 'write')
          AND capability.risk_class <> 'live_execution'
          AND (
            action_record ->> 'mode' <> 'mock'
            OR capability.risk_class = 'mock_execution'
          )
      )
  ) THEN
    RETURN false;
  END IF;

  IF (manifest #> '{records,draft}') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(manifest -> 'actions') action_record
      WHERE action_record ->> 'id' = manifest #>> '{records,draft,action}'
    )
  THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE FUNCTION workflow_private.reject_unsafe_compiled_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  is_compiled BOOLEAN;
BEGIN
  SELECT workflow.skill_source_hash IS NOT NULL
  INTO is_compiled
  FROM public.agent_workflows workflow
  WHERE workflow.id = NEW.workflow_id
    AND workflow.company_id = NEW.company_id;

  IF COALESCE(is_compiled, false)
    AND NOT workflow_private.compiled_binding_snapshot_is_safe(
      NEW.company_id,
      NEW.workflow_id,
      NEW.binding_snapshot_id
    )
  THEN
    RAISE EXCEPTION 'unsafe_compiled_workflow_binding' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_activations_compiled_binding_guard
BEFORE INSERT OR UPDATE ON public.workflow_activations
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_unsafe_compiled_activation();

CREATE FUNCTION workflow_private.persist_compiled_workflow_review_controlled(
  p_company_id UUID,
  p_workflow_id UUID,
  p_binding_snapshot_id UUID,
  p_payload JSONB,
  p_input_hash TEXT,
  p_client_surface TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  target_workflow public.agent_workflows%ROWTYPE;
  definition_record JSONB := p_payload -> 'definition';
  run_record JSONB := p_payload -> 'run';
  event_record JSONB := p_payload -> 'event';
  item_record JSONB := p_payload -> 'item';
  context_record JSONB := p_payload -> 'context_packet';
  recommendation_record JSONB := p_payload -> 'recommendation';
  evidence_record JSONB := p_payload -> 'evidence';
  draft_record JSONB := p_payload -> 'draft';
  audit_records JSONB := p_payload -> 'audit_events';
  audit_record JSONB;
  manifest_digest TEXT;
  payload_hash TEXT;
  canonical_edit_policy JSONB;
  existing_receipt workflow_private.compiled_workflow_persistence_receipts%ROWTYPE;
  existing_event public.workflow_events%ROWTYPE;
  existing_item public.workflow_items%ROWTYPE;
  existing_draft_id UUID;
  result_record JSONB;
  is_duplicate BOOLEAN := false;
  result_item_id UUID;
  result_draft_id UUID;
  forbidden_key_pattern CONSTANT TEXT :=
    '"(access_?token|refresh_?token|raw_?token|token_?hash|authorization|password|secret|credential|api_?key|code_?verifier)"[[:space:]]*:';
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL
    OR p_workflow_id IS NULL
    OR p_binding_snapshot_id IS NULL
    OR p_input_hash IS NULL
    OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_client_surface IS NULL
    OR p_client_surface NOT IN ('cli', 'web', 'api', 'automation')
    OR jsonb_typeof(COALESCE(p_payload, 'null'::JSONB)) <> 'object'
    OR pg_column_size(p_payload) > 2097152
    OR p_payload::TEXT ~* forbidden_key_pattern
  THEN
    RAISE EXCEPTION 'invalid_compiled_workflow_payload' USING ERRCODE = '22023';
  END IF;

  PERFORM workflow_private.require_company_role(
    p_company_id,
    'admin',
    current_user_id
  );

  IF NOT workflow_private.jsonb_object_has_exact_keys(
    p_payload,
    ARRAY[
      'company_id', 'definition', 'run', 'event', 'item', 'context_packet',
      'recommendation', 'evidence', 'draft', 'audit_events'
    ]
  )
    OR p_payload ->> 'company_id' IS DISTINCT FROM p_company_id::TEXT
    OR NOT workflow_private.jsonb_object_has_exact_keys(
      definition_record,
      ARRAY[
        'id', 'company_id', 'workflow_key', 'workflow_type', 'name', 'version',
        'status', 'spec', 'skill_markdown', 'compile_result'
      ]
    )
    OR NOT workflow_private.jsonb_object_has_exact_keys(
      run_record,
      ARRAY[
        'id', 'company_id', 'workflow_id', 'workflow_type', 'status', 'input',
        'langgraph_thread_id', 'langgraph_checkpoint_id', 'langsmith_trace_id',
        'langsmith_run_id', 'started_by', 'started_at', 'completed_at'
      ]
    )
    OR NOT workflow_private.jsonb_object_has_exact_keys(
      event_record,
      ARRAY[
        'id', 'company_id', 'workflow_run_id', 'workflow_id', 'event_key',
        'event_type', 'origin', 'source_ref', 'payload', 'freshness_state',
        'validation_status', 'validation_result', 'created_at'
      ]
    )
    OR jsonb_typeof(audit_records) <> 'array'
    OR jsonb_array_length(audit_records) > 50
  THEN
    RAISE EXCEPTION 'invalid_compiled_workflow_contract' USING ERRCODE = '22023';
  END IF;

  IF item_record <> 'null'::JSONB AND NOT workflow_private.jsonb_object_has_exact_keys(
    item_record,
    ARRAY[
      'id', 'company_id', 'workflow_run_id', 'workflow_event_id', 'workflow_id',
      'item_key', 'item_type', 'title', 'status', 'priority', 'related_records',
      'resolution_state', 'created_at', 'updated_at'
    ]
  ) THEN
    RAISE EXCEPTION 'invalid_compiled_workflow_item' USING ERRCODE = '22023';
  END IF;
  IF context_record <> 'null'::JSONB AND NOT workflow_private.jsonb_object_has_exact_keys(
    context_record,
    ARRAY[
      'id', 'company_id', 'workflow_run_id', 'workflow_item_id', 'sources',
      'facts', 'memory_refs', 'freshness_state', 'warnings', 'created_at'
    ]
  ) THEN
    RAISE EXCEPTION 'invalid_compiled_workflow_context' USING ERRCODE = '22023';
  END IF;
  IF recommendation_record <> 'null'::JSONB AND NOT workflow_private.jsonb_object_has_exact_keys(
    recommendation_record,
    ARRAY[
      'id', 'company_id', 'workflow_run_id', 'workflow_item_id',
      'context_packet_id', 'status', 'rationale_summary', 'warning_state',
      'warnings', 'confidence', 'freshness_state', 'input', 'output',
      'langsmith_trace_id', 'langsmith_run_id', 'created_at'
    ]
  ) THEN
    RAISE EXCEPTION 'invalid_compiled_workflow_recommendation' USING ERRCODE = '22023';
  END IF;
  IF evidence_record <> 'null'::JSONB AND NOT workflow_private.jsonb_object_has_exact_keys(
    evidence_record,
    ARRAY[
      'id', 'company_id', 'workflow_run_id', 'workflow_item_id',
      'recommendation_run_id', 'source_refs', 'assumptions', 'warnings',
      'evidence', 'created_at'
    ]
  ) THEN
    RAISE EXCEPTION 'invalid_compiled_workflow_evidence' USING ERRCODE = '22023';
  END IF;
  IF draft_record <> 'null'::JSONB AND NOT workflow_private.jsonb_object_has_exact_keys(
    draft_record,
    ARRAY[
      'id', 'company_id', 'workflow_run_id', 'workflow_item_id',
      'recommendation_run_id', 'evidence_snapshot_id', 'action_type', 'status',
      'payload', 'payload_hash', 'edit_policy', 'created_at', 'updated_at'
    ]
  ) THEN
    RAISE EXCEPTION 'invalid_compiled_workflow_draft' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(audit_records) candidate
    WHERE NOT workflow_private.jsonb_object_has_exact_keys(
      candidate,
      ARRAY[
        'id', 'company_id', 'actor_type', 'actor_id', 'workflow_run_id',
        'workflow_item_id', 'event_type', 'summary', 'payload', 'trace',
        'created_at'
      ]
    )
  ) THEN
    RAISE EXCEPTION 'invalid_compiled_workflow_audit' USING ERRCODE = '22023';
  END IF;

  -- Every object in the mapped graph must remain inside the requested tenant.
  IF EXISTS (
    SELECT 1
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
    ) candidate
    WHERE candidate <> 'null'::JSONB
      AND candidate ->> 'company_id' IS DISTINCT FROM p_company_id::TEXT
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(audit_records) candidate
    WHERE candidate ->> 'company_id' IS DISTINCT FROM p_company_id::TEXT
  ) THEN
    RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = '22023';
  END IF;

  SELECT workflow.*
  INTO target_workflow
  FROM public.agent_workflows workflow
  WHERE workflow.id = p_workflow_id
    AND workflow.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'workflow_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF target_workflow.skill_source_hash IS NULL
    OR target_workflow.compiled_manifest_hash IS NULL
    OR target_workflow.compiled_at IS NULL
    OR COALESCE((target_workflow.compile_result ->> 'ok')::BOOLEAN, false) IS NOT true
  THEN
    RAISE EXCEPTION 'workflow_not_successfully_compiled' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.workflow_binding_snapshots snapshot
  WHERE snapshot.id = p_binding_snapshot_id
    AND snapshot.company_id = p_company_id
    AND snapshot.workflow_id = p_workflow_id
    AND snapshot.manifest_hash = target_workflow.compiled_manifest_hash;

  IF NOT FOUND OR EXISTS (
    SELECT 1
    FROM public.workflow_binding_snapshot_events snapshot_event
    WHERE snapshot_event.company_id = p_company_id
      AND snapshot_event.binding_snapshot_id = p_binding_snapshot_id
      AND snapshot_event.event_type = 'invalidated'
  ) THEN
    RAISE EXCEPTION 'binding_snapshot_not_activatable' USING ERRCODE = '22023';
  END IF;

  -- A pre-activation sandbox run still requires currently healthy grants and
  -- policies. It only relaxes the activation-pointer requirement.
  IF NOT EXISTS (
    SELECT 1
    FROM public.workflow_capability_bindings binding
    WHERE binding.company_id = p_company_id
      AND binding.binding_snapshot_id = p_binding_snapshot_id
  ) OR EXISTS (
    SELECT 1
    FROM public.workflow_capability_bindings binding
    LEFT JOIN public.company_connector_capability_grants grant_record
      ON grant_record.id = binding.grant_id
     AND grant_record.company_id = binding.company_id
     AND grant_record.capability_version_id = binding.capability_version_id
    LEFT JOIN public.company_connector_installations installation
      ON installation.id = grant_record.installation_id
     AND installation.company_id = grant_record.company_id
    LEFT JOIN public.company_connector_health health
      ON health.installation_id = installation.id
     AND health.company_id = installation.company_id
    LEFT JOIN public.connector_definition_versions connector_version
      ON connector_version.id = installation.connector_version_id
    LEFT JOIN public.company_capability_policies policy
      ON policy.company_id = binding.company_id
     AND policy.capability_version_id = binding.capability_version_id
    WHERE binding.company_id = p_company_id
      AND binding.binding_snapshot_id = p_binding_snapshot_id
      AND (
        grant_record.id IS NULL
        OR grant_record.status <> 'active'
        OR installation.status <> 'connected'
        OR health.status <> 'healthy'
        OR health.observed_schema_hash IS DISTINCT FROM connector_version.schema_hash
        OR policy.enabled IS DISTINCT FROM true
      )
  ) THEN
    RAISE EXCEPTION 'workflow_capability_binding_unhealthy' USING ERRCODE = '55000';
  END IF;

  IF NOT workflow_private.compiled_binding_snapshot_is_safe(
    p_company_id,
    p_workflow_id,
    p_binding_snapshot_id
  ) THEN
    RAISE EXCEPTION 'unsafe_compiled_workflow_binding' USING ERRCODE = '42501';
  END IF;

  manifest_digest := target_workflow.spec ->> 'manifestDigest';
  IF target_workflow.spec #>> '{workflow,default_mode}' IS DISTINCT FROM 'mock'
    OR target_workflow.spec #>> '{identity,id}' IS DISTINCT FROM target_workflow.workflow_key
    OR target_workflow.spec #>> '{identity,version}' IS DISTINCT FROM target_workflow.version
    OR target_workflow.spec #>> '{workflow,type}' IS DISTINCT FROM target_workflow.workflow_type
    OR manifest_digest IS NULL
    OR manifest_digest !~ '^[a-f0-9]{64}$'
    OR definition_record ->> 'id' IS DISTINCT FROM p_workflow_id::TEXT
    OR definition_record ->> 'workflow_key' IS DISTINCT FROM target_workflow.workflow_key
    OR definition_record ->> 'workflow_type' IS DISTINCT FROM target_workflow.workflow_type
    OR definition_record ->> 'version' IS DISTINCT FROM target_workflow.version
    OR run_record ->> 'workflow_id' IS DISTINCT FROM p_workflow_id::TEXT
    OR run_record ->> 'workflow_type' IS DISTINCT FROM target_workflow.workflow_type
    OR run_record #>> '{input,manifestDigest}' IS DISTINCT FROM manifest_digest
    OR event_record ->> 'workflow_id' IS DISTINCT FROM p_workflow_id::TEXT
    OR event_record ->> 'workflow_run_id' IS DISTINCT FROM run_record ->> 'id'
    OR event_record #>> '{payload,manifestDigest}' IS DISTINCT FROM manifest_digest
    OR event_record #>> '{payload,trigger,id}' IS DISTINCT FROM run_record #>> '{input,trigger,id}'
    OR event_record #>> '{payload,trigger,kind}' IS DISTINCT FROM run_record #>> '{input,trigger,kind}'
    OR event_record ->> 'origin' IS DISTINCT FROM run_record #>> '{input,trigger,kind}'
    OR event_record ->> 'event_type' IS DISTINCT FROM
      target_workflow.workflow_type || '_' || (event_record ->> 'origin')
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(target_workflow.spec #> '{workflow,triggers}') trigger_record
      WHERE trigger_record ->> 'id' = run_record #>> '{input,trigger,id}'
        AND trigger_record ->> 'kind' = run_record #>> '{input,trigger,kind}'
    )
  THEN
    RAISE EXCEPTION 'compiled_workflow_manifest_mismatch' USING ERRCODE = '22023';
  END IF;

  IF item_record = 'null'::JSONB THEN
    IF context_record <> 'null'::JSONB
      OR recommendation_record <> 'null'::JSONB
      OR evidence_record <> 'null'::JSONB
      OR draft_record <> 'null'::JSONB
      OR run_record ->> 'status' NOT IN ('suppressed', 'blocked', 'failed')
    THEN
      RAISE EXCEPTION 'invalid_compiled_review_graph' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF context_record = 'null'::JSONB
      OR recommendation_record = 'null'::JSONB
      OR evidence_record = 'null'::JSONB
      OR run_record ->> 'status' IS DISTINCT FROM 'waiting_for_approval'
      OR item_record ->> 'workflow_run_id' IS DISTINCT FROM run_record ->> 'id'
      OR item_record ->> 'workflow_event_id' IS DISTINCT FROM event_record ->> 'id'
      OR item_record ->> 'workflow_id' IS DISTINCT FROM p_workflow_id::TEXT
      OR item_record ->> 'item_type' IS DISTINCT FROM target_workflow.spec #>> '{records,item,type}'
      OR item_record ->> 'status' IS DISTINCT FROM 'active'
      OR item_record #>> '{resolution_state,manifestDigest}' IS DISTINCT FROM manifest_digest
      OR context_record ->> 'workflow_run_id' IS DISTINCT FROM run_record ->> 'id'
      OR context_record ->> 'workflow_item_id' IS DISTINCT FROM item_record ->> 'id'
      OR recommendation_record ->> 'workflow_run_id' IS DISTINCT FROM run_record ->> 'id'
      OR recommendation_record ->> 'workflow_item_id' IS DISTINCT FROM item_record ->> 'id'
      OR recommendation_record ->> 'context_packet_id' IS DISTINCT FROM context_record ->> 'id'
      OR evidence_record ->> 'workflow_run_id' IS DISTINCT FROM run_record ->> 'id'
      OR evidence_record ->> 'workflow_item_id' IS DISTINCT FROM item_record ->> 'id'
      OR evidence_record ->> 'recommendation_run_id' IS DISTINCT FROM recommendation_record ->> 'id'
      OR recommendation_record ->> 'status' IS DISTINCT FROM 'ready_for_review'
    THEN
      RAISE EXCEPTION 'invalid_compiled_review_graph' USING ERRCODE = '22023';
    END IF;

    IF (target_workflow.spec #> '{records,draft}') IS NULL
      AND draft_record <> 'null'::JSONB
    THEN
      RAISE EXCEPTION 'undeclared_compiled_workflow_action' USING ERRCODE = '22023';
    END IF;
    IF (target_workflow.spec #> '{records,draft}') IS NOT NULL
      AND draft_record = 'null'::JSONB
    THEN
      RAISE EXCEPTION 'compiled_workflow_draft_missing' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF draft_record <> 'null'::JSONB THEN
    canonical_edit_policy := jsonb_build_object(
      'editable', COALESCE((target_workflow.spec #>> '{records,draft,edit_policy,editable}')::BOOLEAN, false),
      'requireReason', COALESCE((target_workflow.spec #>> '{records,draft,edit_policy,require_reason}')::BOOLEAN, true),
      'immutablePaths', COALESCE(target_workflow.spec #> '{records,draft,edit_policy,immutable_paths}', '[]'::JSONB),
      'arrayLengthPaths', COALESCE(target_workflow.spec #> '{records,draft,edit_policy,array_length_paths}', '[]'::JSONB),
      'positiveIntegerPaths', COALESCE(target_workflow.spec #> '{records,draft,edit_policy,positive_integer_paths}', '[]'::JSONB),
      'nonEmptyStringPaths', COALESCE(target_workflow.spec #> '{records,draft,edit_policy,non_empty_string_paths}', '[]'::JSONB)
    );

    IF draft_record ->> 'workflow_run_id' IS DISTINCT FROM run_record ->> 'id'
      OR draft_record ->> 'workflow_item_id' IS DISTINCT FROM item_record ->> 'id'
      OR draft_record ->> 'recommendation_run_id' IS DISTINCT FROM recommendation_record ->> 'id'
      OR draft_record ->> 'evidence_snapshot_id' IS DISTINCT FROM evidence_record ->> 'id'
      OR draft_record ->> 'action_type' IS DISTINCT FROM target_workflow.spec #>> '{records,draft,action}'
      OR draft_record ->> 'status' IS DISTINCT FROM 'pending_review'
      OR draft_record -> 'edit_policy' IS DISTINCT FROM canonical_edit_policy
      OR (draft_record -> 'payload') ? 'mode'
        AND draft_record #>> '{payload,mode}' IS DISTINCT FROM 'mock'
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(target_workflow.spec -> 'actions') action_record
        WHERE action_record ->> 'id' = draft_record ->> 'action_type'
          AND action_record ->> 'mode' = 'mock'
          AND COALESCE((action_record ->> 'requires_approval')::BOOLEAN, false)
      )
      OR NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(target_workflow.spec -> 'approvals') approval_record
        WHERE approval_record ->> 'action' = draft_record ->> 'action_type'
          AND COALESCE((approval_record ->> 'human_required')::BOOLEAN, false)
      )
    THEN
      RAISE EXCEPTION 'unsafe_compiled_workflow_action' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(audit_records) candidate
    WHERE candidate ->> 'workflow_run_id' IS DISTINCT FROM run_record ->> 'id'
      OR candidate ->> 'event_type' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
      OR length(candidate ->> 'summary') NOT BETWEEN 1 AND 2000
      OR jsonb_typeof(candidate -> 'payload') <> 'object'
      OR (
        candidate ->> 'workflow_item_id' IS NOT NULL
        AND (
          item_record = 'null'::JSONB
          OR candidate ->> 'workflow_item_id' IS DISTINCT FROM item_record ->> 'id'
        )
      )
  ) THEN
    RAISE EXCEPTION 'unsafe_compiled_workflow_audit' USING ERRCODE = '22023';
  END IF;

  payload_hash := encode(
    extensions.digest(convert_to(p_payload::TEXT, 'UTF8'), 'sha256'),
    'hex'
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::TEXT || ':' || current_user_id::TEXT || ':' || p_input_hash,
      0
    )
  );

  SELECT receipt.*
  INTO existing_receipt
  FROM workflow_private.compiled_workflow_persistence_receipts receipt
  WHERE receipt.company_id = p_company_id
    AND receipt.actor_id = current_user_id
    AND receipt.input_hash = p_input_hash;

  IF FOUND THEN
    IF existing_receipt.payload_hash IS DISTINCT FROM payload_hash
      OR existing_receipt.workflow_id IS DISTINCT FROM p_workflow_id
      OR existing_receipt.binding_snapshot_id IS DISTINCT FROM p_binding_snapshot_id
      OR existing_receipt.client_surface IS DISTINCT FROM p_client_surface
    THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023';
    END IF;
    RETURN existing_receipt.result;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workflow_runs existing_run
    WHERE existing_run.id = (run_record ->> 'id')::UUID
  ) THEN
    RAISE EXCEPTION 'workflow_run_id_conflict' USING ERRCODE = '23505';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_company_id::TEXT || ':event:' || (event_record ->> 'event_key'),
      0
    )
  );
  SELECT workflow_event.*
  INTO existing_event
  FROM public.workflow_events workflow_event
  WHERE workflow_event.company_id = p_company_id
    AND workflow_event.event_key = event_record ->> 'event_key';

  IF FOUND THEN
    IF existing_event.workflow_id IS DISTINCT FROM p_workflow_id THEN
      RAISE EXCEPTION 'compiled_event_key_conflict' USING ERRCODE = '23505';
    END IF;
    SELECT workflow_item.*
    INTO existing_item
    FROM public.workflow_items workflow_item
    WHERE workflow_item.company_id = p_company_id
      AND workflow_item.workflow_event_id = existing_event.id
    ORDER BY workflow_item.created_at DESC
    LIMIT 1;
    is_duplicate := true;
  ELSIF item_record <> 'null'::JSONB THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        p_company_id::TEXT || ':item:' || (item_record ->> 'item_key'),
        0
      )
    );
    SELECT workflow_item.*
    INTO existing_item
    FROM public.workflow_items workflow_item
    WHERE workflow_item.company_id = p_company_id
      AND workflow_item.item_key = item_record ->> 'item_key'
      AND workflow_item.status IN ('active', 'blocked', 'approved')
    ORDER BY workflow_item.created_at DESC
    LIMIT 1;
    IF FOUND THEN
      IF existing_item.workflow_id IS DISTINCT FROM p_workflow_id THEN
        RAISE EXCEPTION 'compiled_item_key_conflict' USING ERRCODE = '23505';
      END IF;
      is_duplicate := true;
    END IF;
  END IF;

  run_record := run_record || jsonb_build_object(
    'company_id', p_company_id,
    'workflow_id', p_workflow_id,
    'workflow_binding_snapshot_id', p_binding_snapshot_id,
    'started_by', current_user_id,
    'started_at', now(),
    'status', CASE WHEN is_duplicate THEN 'suppressed' ELSE run_record ->> 'status' END,
    'completed_at', CASE
      WHEN is_duplicate OR run_record ->> 'status' IN ('suppressed', 'blocked', 'executed', 'failed', 'rejected', 'rework_requested')
        THEN to_jsonb(now())
      ELSE 'null'::JSONB
    END
  );

  INSERT INTO public.workflow_runs
  SELECT * FROM jsonb_populate_record(NULL::public.workflow_runs, run_record);

  IF existing_event.id IS NULL THEN
    event_record := event_record || jsonb_build_object(
      'company_id', p_company_id,
      'workflow_id', p_workflow_id,
      'created_at', now()
    );
    INSERT INTO public.workflow_events
    SELECT * FROM jsonb_populate_record(NULL::public.workflow_events, event_record);
  END IF;

  IF is_duplicate THEN
    result_item_id := existing_item.id;
    IF result_item_id IS NOT NULL THEN
      SELECT draft.id
      INTO existing_draft_id
      FROM public.workflow_action_drafts draft
      WHERE draft.company_id = p_company_id
        AND draft.workflow_item_id = result_item_id
      ORDER BY draft.updated_at DESC
      LIMIT 1;
      result_draft_id := existing_draft_id;
    END IF;

    INSERT INTO public.workflow_audit_events (
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
      p_company_id,
      'user',
      current_user_id,
      (run_record ->> 'id')::UUID,
      result_item_id,
      'compiled_workflow_sandbox_duplicate_suppressed',
      'Sandbox test reused an existing durable workflow review.',
      jsonb_build_object(
        'test', true,
        'workflowId', p_workflow_id,
        'bindingSnapshotId', p_binding_snapshot_id,
        'existingEventId', existing_event.id,
        'existingItemId', result_item_id
      ),
      jsonb_build_object(
        'langGraphThreadId', run_record ->> 'langgraph_thread_id',
        'langGraphCheckpointId', run_record ->> 'langgraph_checkpoint_id',
        'langSmithTraceId', run_record ->> 'langsmith_trace_id',
        'langSmithRunId', run_record ->> 'langsmith_run_id'
      )
    );
  ELSE
    IF item_record <> 'null'::JSONB THEN
      item_record := item_record || jsonb_build_object(
        'company_id', p_company_id,
        'workflow_id', p_workflow_id,
        'created_at', now(),
        'updated_at', now()
      );
      INSERT INTO public.workflow_items
      SELECT * FROM jsonb_populate_record(NULL::public.workflow_items, item_record);
      result_item_id := (item_record ->> 'id')::UUID;

      context_record := context_record || jsonb_build_object('created_at', now());
      INSERT INTO public.workflow_context_packets
      SELECT * FROM jsonb_populate_record(NULL::public.workflow_context_packets, context_record);

      recommendation_record := recommendation_record || jsonb_build_object('created_at', now());
      INSERT INTO public.workflow_recommendation_runs
      SELECT * FROM jsonb_populate_record(NULL::public.workflow_recommendation_runs, recommendation_record);

      evidence_record := evidence_record || jsonb_build_object('created_at', now());
      INSERT INTO public.workflow_evidence_snapshots
      SELECT * FROM jsonb_populate_record(NULL::public.workflow_evidence_snapshots, evidence_record);

      IF draft_record <> 'null'::JSONB THEN
        draft_record := draft_record || jsonb_build_object(
          'payload_hash', encode(
            extensions.digest(convert_to((draft_record -> 'payload')::TEXT, 'UTF8'), 'sha256'),
            'hex'
          ),
          'created_at', now(),
          'updated_at', now()
        );
        INSERT INTO public.workflow_action_drafts
        SELECT * FROM jsonb_populate_record(NULL::public.workflow_action_drafts, draft_record);
        result_draft_id := (draft_record ->> 'id')::UUID;
      END IF;
    END IF;

    FOR audit_record IN SELECT value FROM jsonb_array_elements(audit_records)
    LOOP
      audit_record := audit_record || jsonb_build_object(
        'actor_type', 'user',
        'actor_id', current_user_id,
        'created_at', now(),
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

    INSERT INTO public.workflow_audit_events (
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
      p_company_id,
      'user',
      current_user_id,
      (run_record ->> 'id')::UUID,
      result_item_id,
      'compiled_workflow_sandbox_persisted',
      'Compiled workflow sandbox test persisted a durable review graph.',
      jsonb_build_object(
        'test', true,
        'workflowId', p_workflow_id,
        'bindingSnapshotId', p_binding_snapshot_id,
        'manifestDigest', manifest_digest
      ),
      jsonb_build_object(
        'langGraphThreadId', run_record ->> 'langgraph_thread_id',
        'langGraphCheckpointId', run_record ->> 'langgraph_checkpoint_id',
        'langSmithTraceId', run_record ->> 'langsmith_trace_id',
        'langSmithRunId', run_record ->> 'langsmith_run_id'
      )
    );
  END IF;

  result_record := jsonb_build_object(
    'workflowRunId', run_record ->> 'id',
    'itemId', result_item_id,
    'draftId', result_draft_id,
    'duplicate', is_duplicate
  );

  PERFORM workflow_private.record_workflow_control_request(
    p_company_id,
    p_client_surface,
    p_input_hash,
    jsonb_build_object(
      'kind', 'run_compiled_workflow_test',
      'workflowId', p_workflow_id,
      'bindingSnapshotId', p_binding_snapshot_id,
      'duplicate', is_duplicate
    ),
    'explicit',
    'executed',
    'state_change',
    (run_record ->> 'id')::UUID,
    CASE WHEN is_duplicate THEN NULL ELSE result_item_id END,
    run_record ->> 'langsmith_trace_id',
    run_record ->> 'langsmith_run_id'
  );

  INSERT INTO workflow_private.compiled_workflow_persistence_receipts (
    company_id,
    actor_id,
    input_hash,
    client_surface,
    payload_hash,
    workflow_id,
    binding_snapshot_id,
    workflow_run_id,
    workflow_item_id,
    action_draft_id,
    result
  )
  VALUES (
    p_company_id,
    current_user_id,
    p_input_hash,
    p_client_surface,
    payload_hash,
    p_workflow_id,
    p_binding_snapshot_id,
    (run_record ->> 'id')::UUID,
    result_item_id,
    result_draft_id,
    result_record
  );

  RETURN result_record;
END;
$$;

CREATE FUNCTION public.persist_compiled_workflow_review_controlled(
  p_company_id UUID,
  p_workflow_id UUID,
  p_binding_snapshot_id UUID,
  p_payload JSONB,
  p_input_hash TEXT,
  p_client_surface TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.persist_compiled_workflow_review_controlled(
    p_company_id,
    p_workflow_id,
    p_binding_snapshot_id,
    p_payload,
    p_input_hash,
    p_client_surface
  )
$$;

CREATE FUNCTION workflow_private.enqueue_compiled_workflow_resume()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_run public.workflow_runs%ROWTYPE;
  target_workflow public.agent_workflows%ROWTYPE;
  target_dedupe_key TEXT;
BEGIN
  IF NEW.decision NOT IN ('approve', 'edit') THEN
    RETURN NEW;
  END IF;

  SELECT workflow_run.*
  INTO target_run
  FROM public.workflow_runs workflow_run
  WHERE workflow_run.id = NEW.workflow_run_id
    AND workflow_run.company_id = NEW.company_id;

  IF NOT FOUND OR target_run.workflow_binding_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT workflow.*
  INTO target_workflow
  FROM public.agent_workflows workflow
  WHERE workflow.id = target_run.workflow_id
    AND workflow.company_id = target_run.company_id;

  IF NOT FOUND OR target_workflow.skill_source_hash IS NULL THEN
    RETURN NEW;
  END IF;

  target_dedupe_key := encode(
    extensions.digest(
      convert_to(
        NEW.company_id::TEXT || ':' || NEW.workflow_run_id::TEXT || ':' ||
        NEW.workflow_item_id::TEXT || ':' || NEW.action_draft_id::TEXT || ':' ||
        NEW.id::TEXT || ':resume_after_approval',
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.workflow_resume_outbox (
    company_id,
    workflow_run_id,
    binding_snapshot_id,
    node_key,
    event_type,
    checkpoint,
    payload,
    dedupe_key,
    status,
    available_at
  )
  VALUES (
    NEW.company_id,
    NEW.workflow_run_id,
    target_run.workflow_binding_snapshot_id,
    'human_approval',
    'resume_after_approval',
    jsonb_build_object(
      'langGraphThreadId', target_run.langgraph_thread_id,
      'langGraphCheckpointId', target_run.langgraph_checkpoint_id
    ),
    jsonb_build_object(
      'decisionId', NEW.id,
      'actionDraftId', NEW.action_draft_id,
      'workflowItemId', NEW.workflow_item_id,
      'decision', NEW.decision
    ),
    target_dedupe_key,
    'pending',
    now()
  )
  ON CONFLICT (company_id, dedupe_key) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_decisions_enqueue_compiled_resume
AFTER INSERT ON public.workflow_decisions
FOR EACH ROW EXECUTE FUNCTION workflow_private.enqueue_compiled_workflow_resume();

REVOKE ALL ON FUNCTION workflow_private.jsonb_object_has_exact_keys(JSONB, TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.compiled_binding_snapshot_is_safe(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.reject_unsafe_compiled_activation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.persist_compiled_workflow_review_controlled(UUID, UUID, UUID, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.enqueue_compiled_workflow_resume()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_compiled_workflow_review_controlled(UUID, UUID, UUID, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_compiled_workflow_review_controlled(UUID, UUID, UUID, JSONB, TEXT, TEXT)
  TO authenticated;
