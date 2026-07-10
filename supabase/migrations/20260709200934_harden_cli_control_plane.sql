-- Make workflow mutations and their control-plane audit records one
-- authoritative transaction, while keeping implementation functions private.

ALTER TABLE public.workflow_control_requests
  ADD CONSTRAINT workflow_control_requests_sensitive_intent_keys_check
  CHECK (
    normalized_intent::TEXT !~*
      '"(access_?token|refresh_?token|raw_?token|token_?hash|authorization|password|secret|code_?verifier|raw_?input|raw_?command|command_?text|prompt|message)"[[:space:]]*:'
  );

CREATE FUNCTION workflow_private.is_safe_standalone_control_intent(
  p_company_id UUID,
  p_normalized_intent JSONB,
  p_resolution_status TEXT,
  p_risk_class TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  intent_kind TEXT := p_normalized_intent ->> 'kind';
  uuid_pattern CONSTANT TEXT := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF jsonb_typeof(p_normalized_intent) <> 'object' THEN
    RETURN false;
  END IF;

  IF intent_kind = 'unresolved' THEN
    RETURN p_normalized_intent - ARRAY['kind', 'outcome'] = '{}'::JSONB
      AND p_normalized_intent ->> 'outcome' IN ('clarification_required', 'blocked', 'failed')
      AND p_resolution_status = p_normalized_intent ->> 'outcome';
  END IF;

  IF p_normalized_intent ->> 'companyId' IS DISTINCT FROM p_company_id::TEXT
    OR p_normalized_intent ->> 'risk' IS DISTINCT FROM p_risk_class
  THEN
    RETURN false;
  END IF;

  CASE intent_kind
    WHEN 'list_work_items' THEN
      RETURN p_risk_class = 'read'
        AND p_resolution_status IN ('resolved', 'executed', 'failed')
        AND p_normalized_intent - ARRAY['kind', 'companyId', 'status', 'risk'] = '{}'::JSONB
        AND (
          NOT (p_normalized_intent ? 'status')
          OR p_normalized_intent ->> 'status' IN ('active', 'blocked', 'approved', 'rejected', 'executed', 'resolved')
        );
    WHEN 'inspect_work_item' THEN
      RETURN p_risk_class = 'read'
        AND p_resolution_status IN ('resolved', 'executed', 'failed')
        AND p_normalized_intent - ARRAY['kind', 'companyId', 'itemId', 'risk'] = '{}'::JSONB
        AND p_normalized_intent ->> 'itemId' ~ uuid_pattern;
    WHEN 'run_fixture' THEN
      RETURN p_risk_class = 'state_change'
        AND p_resolution_status IN ('resolved', 'blocked', 'failed')
        AND p_normalized_intent - ARRAY['kind', 'companyId', 'scenarioId', 'risk'] = '{}'::JSONB
        AND p_normalized_intent ->> 'scenarioId' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$';
    WHEN 'record_decision' THEN
      RETURN p_risk_class = 'state_change'
        AND p_resolution_status IN ('resolved', 'blocked', 'failed')
        AND p_normalized_intent - ARRAY[
          'kind', 'companyId', 'itemId', 'decision', 'patchPointers',
          'patchCount', 'warningsAcknowledged', 'risk'
        ] = '{}'::JSONB
        AND p_normalized_intent ->> 'itemId' ~ uuid_pattern
        AND p_normalized_intent ->> 'decision' IN ('approve', 'edit', 'reject', 'request_rework')
        AND jsonb_typeof(p_normalized_intent -> 'patchPointers') = 'array'
        AND jsonb_typeof(p_normalized_intent -> 'patchCount') = 'number'
        AND (p_normalized_intent ->> 'patchCount')::INTEGER = jsonb_array_length(p_normalized_intent -> 'patchPointers')
        AND jsonb_typeof(p_normalized_intent -> 'warningsAcknowledged') = 'boolean'
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_normalized_intent -> 'patchPointers') pointer
          WHERE jsonb_typeof(pointer) <> 'string'
            OR length(pointer #>> '{}') NOT BETWEEN 1 AND 1000
        );
    WHEN 'execute_mock_action' THEN
      RETURN p_risk_class = 'mock_execution'
        AND p_resolution_status IN ('resolved', 'blocked', 'failed')
        AND p_normalized_intent - ARRAY['kind', 'companyId', 'itemId', 'risk'] = '{}'::JSONB
        AND p_normalized_intent ->> 'itemId' ~ uuid_pattern;
    ELSE
      RETURN false;
  END CASE;
END;
$$;

CREATE FUNCTION workflow_private.persist_workflow_fixture_run_controlled(
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
  mutation_result JSONB;
  target_company_id UUID;
  workflow_run_id UUID;
  workflow_item_id UUID;
  is_duplicate BOOLEAN;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_input_hash IS NULL
    OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_client_surface IS NULL
    OR p_client_surface NOT IN ('cli', 'web', 'api', 'automation')
  THEN
    RAISE EXCEPTION 'invalid_control_metadata' USING ERRCODE = '22023';
  END IF;

  PERFORM workflow_private.require_company_role(
    (p_payload ->> 'company_id')::UUID,
    'admin',
    current_user_id
  );

  mutation_result := workflow_private.persist_workflow_fixture_run(p_payload);
  target_company_id := (mutation_result #>> '{run,company_id}')::UUID;
  workflow_run_id := (mutation_result #>> '{run,id}')::UUID;
  is_duplicate := COALESCE((mutation_result ->> 'duplicate')::BOOLEAN, false);

  -- Duplicate fixture results can refer to an item owned by the original run.
  -- Link the control request only to the newly returned suppressed run.
  IF NOT is_duplicate THEN
    workflow_item_id := NULLIF(mutation_result ->> 'itemId', '')::UUID;
  END IF;

  PERFORM workflow_private.record_workflow_control_request(
    target_company_id,
    p_client_surface,
    p_input_hash,
    jsonb_build_object(
      'kind', 'run_fixture',
      'duplicate', is_duplicate
    ),
    'explicit',
    'executed',
    'state_change',
    workflow_run_id,
    workflow_item_id,
    NULL,
    NULL
  );

  RETURN mutation_result;
END;
$$;

CREATE FUNCTION public.persist_workflow_fixture_run_controlled(
  p_payload JSONB,
  p_input_hash TEXT,
  p_client_surface TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.persist_workflow_fixture_run_controlled(
    p_payload,
    p_input_hash,
    p_client_surface
  )
$$;

CREATE FUNCTION workflow_private.record_workflow_decision_controlled(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision TEXT,
  p_input_hash TEXT,
  p_client_surface TEXT,
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
  mutation_result JSONB;
  target_company_id UUID;
  workflow_run_id UUID;
  workflow_item_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_input_hash IS NULL
    OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_client_surface IS NULL
    OR p_client_surface NOT IN ('cli', 'web', 'api', 'automation')
  THEN
    RAISE EXCEPTION 'invalid_control_metadata' USING ERRCODE = '22023';
  END IF;

  mutation_result := workflow_private.record_workflow_decision(
    p_company_id,
    p_action_draft_id,
    p_decision,
    p_reason,
    p_warnings_acknowledged,
    p_edited_payload
  );

  target_company_id := (mutation_result #>> '{item,company_id}')::UUID;
  workflow_run_id := (mutation_result #>> '{item,workflow_run_id}')::UUID;
  workflow_item_id := (mutation_result #>> '{item,id}')::UUID;

  PERFORM workflow_private.record_workflow_control_request(
    target_company_id,
    p_client_surface,
    p_input_hash,
    jsonb_build_object(
      'kind', 'record_decision',
      'decision', mutation_result #>> '{decision,decision}',
      'actionDraftId', mutation_result #>> '{draft,id}',
      'workflowItemId', mutation_result #>> '{item,id}',
      'warningsAcknowledged', COALESCE(
        (mutation_result #>> '{decision,warnings_acknowledged}')::BOOLEAN,
        false
      ),
      'edited', (mutation_result #>> '{decision,decision}') = 'edit'
    ),
    'explicit',
    'executed',
    'state_change',
    workflow_run_id,
    workflow_item_id,
    NULL,
    NULL
  );

  RETURN mutation_result;
END;
$$;

CREATE FUNCTION public.record_workflow_decision_controlled(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision TEXT,
  p_input_hash TEXT,
  p_client_surface TEXT,
  p_reason TEXT DEFAULT NULL,
  p_warnings_acknowledged BOOLEAN DEFAULT false,
  p_edited_payload JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.record_workflow_decision_controlled(
    p_company_id,
    p_action_draft_id,
    p_decision,
    p_input_hash,
    p_client_surface,
    p_reason,
    p_warnings_acknowledged,
    p_edited_payload
  )
$$;

CREATE FUNCTION workflow_private.execute_mock_workflow_action_controlled(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision_id UUID,
  p_raw_token TEXT,
  p_idempotency_key TEXT,
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
  mutation_result JSONB;
  target_company_id UUID;
  workflow_run_id UUID;
  workflow_item_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_input_hash IS NULL
    OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_client_surface IS NULL
    OR p_client_surface NOT IN ('cli', 'web', 'api', 'automation')
  THEN
    RAISE EXCEPTION 'invalid_control_metadata' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR p_idempotency_key !~
    '^(cli|web|api):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'invalid_execution_request' USING ERRCODE = '22023';
  END IF;

  mutation_result := workflow_private.execute_mock_workflow_action(
    p_company_id,
    p_action_draft_id,
    p_decision_id,
    p_raw_token,
    p_idempotency_key,
    p_payload
  );

  target_company_id := (mutation_result #>> '{item,company_id}')::UUID;
  workflow_run_id := (mutation_result #>> '{item,workflow_run_id}')::UUID;
  workflow_item_id := (mutation_result #>> '{item,id}')::UUID;

  PERFORM workflow_private.record_workflow_control_request(
    target_company_id,
    p_client_surface,
    p_input_hash,
    jsonb_build_object(
      'kind', 'execute_mock_action',
      'actionDraftId', mutation_result #>> '{draft,id}',
      'decisionId', mutation_result #>> '{attempt,decision_id}',
      'workflowItemId', mutation_result #>> '{item,id}'
    ),
    'explicit',
    'executed',
    'mock_execution',
    workflow_run_id,
    workflow_item_id,
    NULL,
    NULL
  );

  RETURN mutation_result;
END;
$$;

CREATE FUNCTION public.execute_mock_workflow_action_controlled(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision_id UUID,
  p_raw_token TEXT,
  p_idempotency_key TEXT,
  p_payload JSONB,
  p_input_hash TEXT,
  p_client_surface TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.execute_mock_workflow_action_controlled(
    p_company_id,
    p_action_draft_id,
    p_decision_id,
    p_raw_token,
    p_idempotency_key,
    p_payload,
    p_input_hash,
    p_client_surface
  )
$$;

-- Preserve the checked free-form read-audit endpoint while keeping its
-- implementation inaccessible to API roles.
CREATE OR REPLACE FUNCTION public.record_workflow_control_request(
  p_company_id UUID,
  p_client_surface TEXT,
  p_input_hash TEXT,
  p_normalized_intent JSONB,
  p_parser_kind TEXT,
  p_resolution_status TEXT,
  p_risk_class TEXT,
  p_workflow_run_id UUID DEFAULT NULL,
  p_workflow_item_id UUID DEFAULT NULL,
  p_langsmith_trace_id TEXT DEFAULT NULL,
  p_langsmith_run_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT workflow_private.is_safe_standalone_control_intent(
    p_company_id,
    p_normalized_intent,
    p_resolution_status,
    p_risk_class
  ) THEN
    RAISE EXCEPTION 'invalid_control_request' USING ERRCODE = '22023';
  END IF;

  RETURN workflow_private.record_workflow_control_request(
    p_company_id,
    p_client_surface,
    p_input_hash,
    p_normalized_intent,
    p_parser_kind,
    p_resolution_status,
    p_risk_class,
    p_workflow_run_id,
    p_workflow_item_id,
    p_langsmith_trace_id,
    p_langsmith_run_id
  );
END;
$$;

-- Token reissue remains available through its checked public endpoint, but
-- direct execution of the private implementation is removed below.
CREATE OR REPLACE FUNCTION public.reissue_workflow_execution_token(
  p_company_id UUID,
  p_action_draft_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.reissue_workflow_execution_token(
    p_company_id,
    p_action_draft_id
  )
$$;

CREATE OR REPLACE FUNCTION workflow_private.record_workflow_execution_failure(
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
    'token_not_found',
    'token_revoked'
  ) OR p_idempotency_key IS NULL OR p_idempotency_key !~
    '^(cli|web|api):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
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

  PERFORM workflow_private.require_company_role(
    p_company_id,
    COALESCE(minimum_role, 'approver'),
    current_user_id
  );

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
      'idempotencyKeyHash', encode(
        extensions.digest(convert_to(p_idempotency_key, 'UTF8'), 'sha256'),
        'hex'
      )
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

DROP POLICY IF EXISTS company_memberships_self_disable
  ON public.company_memberships;
REVOKE UPDATE ON TABLE public.company_memberships FROM authenticated;

CREATE FUNCTION workflow_private.disable_own_company_membership(
  p_company_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  membership_role TEXT;
  active_owner_count BIGINT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM company.id
  FROM public.companies company
  WHERE company.id = p_company_id
  FOR UPDATE;

  SELECT membership.role
  INTO membership_role
  FROM public.company_memberships membership
  WHERE membership.company_id = p_company_id
    AND membership.user_id = current_user_id
    AND membership.status = 'active';

  IF membership_role IS NULL THEN
    RETURN false;
  END IF;

  IF membership_role = 'owner' THEN
    SELECT count(*)
    INTO active_owner_count
    FROM public.company_memberships membership
    WHERE membership.company_id = p_company_id
      AND membership.role = 'owner'
      AND membership.status = 'active';

    IF active_owner_count <= 1 THEN
      RAISE EXCEPTION 'last_active_owner' USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.company_memberships
  SET status = 'disabled', updated_at = now()
  WHERE company_id = p_company_id
    AND user_id = current_user_id
    AND status = 'active';

  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.disable_own_company_membership(
  p_company_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.disable_own_company_membership(p_company_id)
$$;

CREATE OR REPLACE FUNCTION public.record_workflow_execution_failure(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_idempotency_key TEXT,
  p_error_code TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.record_workflow_execution_failure(
    p_company_id,
    p_action_draft_id,
    p_idempotency_key,
    p_error_code
  )
$$;

-- No API role may invoke implementation functions directly.
REVOKE ALL ON FUNCTION workflow_private.persist_workflow_fixture_run(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_workflow_decision(
  UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.execute_mock_workflow_action(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.execute_mock_workflow_action_core(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_workflow_control_request(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.reissue_workflow_execution_token(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_workflow_execution_failure(
  UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.persist_workflow_fixture_run_controlled(
  JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_workflow_decision_controlled(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.execute_mock_workflow_action_controlled(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.is_safe_standalone_control_intent(
  UUID, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.disable_own_company_membership(UUID)
  FROM PUBLIC, anon, authenticated;

-- Retire the three unaudited public mutation entry points.
REVOKE ALL ON FUNCTION public.persist_workflow_fixture_run(JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_workflow_decision(
  UUID, UUID, TEXT, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_mock_workflow_action(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.persist_workflow_fixture_run_controlled(JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_workflow_decision_controlled(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_mock_workflow_action_controlled(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_workflow_control_request(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reissue_workflow_execution_token(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_workflow_execution_failure(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disable_own_company_membership(UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.persist_workflow_fixture_run_controlled(JSONB, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_decision_controlled(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_mock_workflow_action_controlled(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_control_request(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reissue_workflow_execution_token(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_own_company_membership(UUID)
  TO authenticated;

-- Workflow state is writable only through checked SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.agent_workflows FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_runs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_context_packets FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_recommendation_runs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_evidence_snapshots FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_action_drafts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_decisions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_execution_tokens FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_action_attempts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.workflow_audit_events FROM authenticated;

ALTER TABLE public.workflow_control_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.workflow_execution_tokens FROM PUBLIC, anon, authenticated;
