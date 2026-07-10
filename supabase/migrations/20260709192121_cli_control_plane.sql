-- Generic control-plane audit records and recoverable workflow execution capabilities.

CREATE TABLE public.workflow_control_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  client_surface TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  normalized_intent JSONB NOT NULL,
  parser_kind TEXT NOT NULL,
  resolution_status TEXT NOT NULL,
  risk_class TEXT NOT NULL,
  workflow_run_id UUID,
  workflow_item_id UUID,
  langsmith_trace_id TEXT,
  langsmith_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workflow_control_requests_client_surface_check
    CHECK (client_surface IN ('cli', 'web', 'api', 'automation')),
  CONSTRAINT workflow_control_requests_input_hash_check
    CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT workflow_control_requests_normalized_intent_check
    CHECK (
      jsonb_typeof(normalized_intent) = 'object'
      AND normalized_intent ? 'kind'
      AND jsonb_typeof(normalized_intent -> 'kind') = 'string'
      AND length(normalized_intent ->> 'kind') BETWEEN 1 AND 100
      AND octet_length(normalized_intent::TEXT) <= 16384
      AND normalized_intent::TEXT !~*
        '"(raw_?input|raw_?command|command_?text|prompt|message)"[[:space:]]*:'
    ),
  CONSTRAINT workflow_control_requests_parser_kind_check
    CHECK (parser_kind IN ('explicit', 'deterministic', 'langchain')),
  CONSTRAINT workflow_control_requests_resolution_status_check
    CHECK (resolution_status IN ('resolved', 'clarification_required', 'blocked', 'executed', 'failed')),
  CONSTRAINT workflow_control_requests_risk_class_check
    CHECK (risk_class IN ('read', 'state_change', 'mock_execution')),
  CONSTRAINT workflow_control_requests_langsmith_trace_id_check
    CHECK (
      langsmith_trace_id IS NULL
      OR (
        length(langsmith_trace_id) BETWEEN 1 AND 255
        AND langsmith_trace_id !~ '[[:cntrl:]]'
      )
    ),
  CONSTRAINT workflow_control_requests_langsmith_run_id_check
    CHECK (
      langsmith_run_id IS NULL
      OR (
        length(langsmith_run_id) BETWEEN 1 AND 255
        AND langsmith_run_id !~ '[[:cntrl:]]'
      )
    ),
  CONSTRAINT workflow_control_requests_timestamp_check
    CHECK (updated_at >= created_at),
  CONSTRAINT workflow_control_requests_run_company_fkey
    FOREIGN KEY (workflow_run_id, company_id)
    REFERENCES public.workflow_runs(id, company_id) ON DELETE RESTRICT,
  CONSTRAINT workflow_control_requests_item_company_fkey
    FOREIGN KEY (workflow_item_id, company_id)
    REFERENCES public.workflow_items(id, company_id) ON DELETE RESTRICT
);

CREATE INDEX workflow_control_requests_company_created_idx
  ON public.workflow_control_requests (company_id, created_at DESC);

CREATE INDEX workflow_control_requests_item_idx
  ON public.workflow_control_requests (workflow_item_id, created_at DESC)
  WHERE workflow_item_id IS NOT NULL;

CREATE TRIGGER workflow_control_requests_touch
BEFORE UPDATE ON public.workflow_control_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.workflow_control_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY workflow_control_requests_member_select
  ON public.workflow_control_requests
  FOR SELECT
  TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

REVOKE ALL ON TABLE public.workflow_control_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workflow_control_requests TO authenticated;

CREATE FUNCTION workflow_private.record_workflow_control_request(
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
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  control_request public.workflow_control_requests%ROWTYPE;
  linked_run public.workflow_runs%ROWTYPE;
  linked_item public.workflow_items%ROWTYPE;
  effective_workflow_run_id UUID := p_workflow_run_id;
  normalized_trace_id TEXT := NULLIF(btrim(p_langsmith_trace_id), '');
  normalized_run_id TEXT := NULLIF(btrim(p_langsmith_run_id), '');
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL
    OR p_client_surface IS NULL
    OR p_client_surface NOT IN ('cli', 'web', 'api', 'automation')
    OR p_input_hash IS NULL
    OR p_input_hash !~ '^[0-9a-f]{64}$'
    OR p_normalized_intent IS NULL
    OR jsonb_typeof(p_normalized_intent) <> 'object'
    OR NOT (p_normalized_intent ? 'kind')
    OR jsonb_typeof(p_normalized_intent -> 'kind') <> 'string'
    OR length(p_normalized_intent ->> 'kind') NOT BETWEEN 1 AND 100
    OR octet_length(p_normalized_intent::TEXT) > 16384
    OR p_normalized_intent::TEXT ~*
      '"(raw_?input|raw_?command|command_?text|prompt|message)"[[:space:]]*:'
    OR p_parser_kind IS NULL
    OR p_parser_kind NOT IN ('explicit', 'deterministic', 'langchain')
    OR p_resolution_status IS NULL
    OR p_resolution_status NOT IN ('resolved', 'clarification_required', 'blocked', 'executed', 'failed')
    OR p_risk_class IS NULL
    OR p_risk_class NOT IN ('read', 'state_change', 'mock_execution')
    OR (normalized_trace_id IS NOT NULL AND (
      length(normalized_trace_id) > 255 OR normalized_trace_id ~ '[[:cntrl:]]'
    ))
    OR (normalized_run_id IS NOT NULL AND (
      length(normalized_run_id) > 255 OR normalized_run_id ~ '[[:cntrl:]]'
    ))
  THEN
    RAISE EXCEPTION 'invalid_control_request' USING ERRCODE = '22023';
  END IF;

  PERFORM workflow_private.require_company_role(p_company_id, 'agent', current_user_id);

  IF p_workflow_item_id IS NOT NULL THEN
    SELECT item_row.*
    INTO linked_item
    FROM public.workflow_items item_row
    WHERE item_row.id = p_workflow_item_id
      AND item_row.company_id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'linked_item_company_mismatch' USING ERRCODE = '22023';
    END IF;

    IF effective_workflow_run_id IS NULL THEN
      effective_workflow_run_id := linked_item.workflow_run_id;
    ELSIF linked_item.workflow_run_id <> effective_workflow_run_id THEN
      RAISE EXCEPTION 'linked_item_run_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF effective_workflow_run_id IS NOT NULL THEN
    SELECT run_row.*
    INTO linked_run
    FROM public.workflow_runs run_row
    WHERE run_row.id = effective_workflow_run_id
      AND run_row.company_id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'linked_run_company_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.workflow_control_requests (
    company_id,
    actor_id,
    client_surface,
    input_hash,
    normalized_intent,
    parser_kind,
    resolution_status,
    risk_class,
    workflow_run_id,
    workflow_item_id,
    langsmith_trace_id,
    langsmith_run_id
  )
  VALUES (
    p_company_id,
    current_user_id,
    p_client_surface,
    p_input_hash,
    p_normalized_intent,
    p_parser_kind,
    p_resolution_status,
    p_risk_class,
    effective_workflow_run_id,
    p_workflow_item_id,
    normalized_trace_id,
    normalized_run_id
  )
  RETURNING * INTO control_request;

  IF effective_workflow_run_id IS NOT NULL THEN
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
      effective_workflow_run_id,
      p_workflow_item_id,
      'control_request_recorded',
      'Workflow control request recorded.',
      jsonb_build_object(
        'controlRequestId', control_request.id,
        'clientSurface', control_request.client_surface,
        'intentKind', control_request.normalized_intent ->> 'kind',
        'riskClass', control_request.risk_class,
        'resolutionStatus', control_request.resolution_status
      ),
      jsonb_build_object(
        'langGraphThreadId', linked_run.langgraph_thread_id,
        'langGraphCheckpointId', linked_run.langgraph_checkpoint_id,
        'langSmithTraceId', linked_run.langsmith_trace_id,
        'langSmithRunId', linked_run.langsmith_run_id
      )
    );
  END IF;

  RETURN to_jsonb(control_request);
END;
$$;

CREATE FUNCTION public.record_workflow_control_request(
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
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.record_workflow_control_request(
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
  )
$$;

ALTER TABLE public.workflow_execution_tokens
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD COLUMN revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT workflow_execution_tokens_revocation_actor_check
    CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL),
  ADD CONSTRAINT workflow_execution_tokens_terminal_state_check
    CHECK (NOT (revoked_at IS NOT NULL AND consumed_at IS NOT NULL));

CREATE INDEX workflow_execution_tokens_active_draft_idx
  ON public.workflow_execution_tokens (action_draft_id, expires_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- Token rows remain private; callers receive only the one-time raw value from
-- checked RPC results.
REVOKE ALL ON TABLE public.workflow_execution_tokens FROM PUBLIC, anon, authenticated;

CREATE FUNCTION workflow_private.reject_revoked_workflow_execution_token_consumption()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL
    AND OLD.consumed_at IS NULL
    AND NEW.consumed_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'token_revoked' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_execution_tokens_reject_revoked_consumption
BEFORE UPDATE OF consumed_at ON public.workflow_execution_tokens
FOR EACH ROW
WHEN (OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL)
EXECUTE FUNCTION workflow_private.reject_revoked_workflow_execution_token_consumption();

-- Keep the original execution transaction as the core implementation. The
-- checked wrapper rejects revoked capabilities before its idempotent-return
-- branch, while the trigger above closes the reissue/consume race.
ALTER FUNCTION workflow_private.execute_mock_workflow_action(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) RENAME TO execute_mock_workflow_action_core;

REVOKE ALL ON FUNCTION workflow_private.execute_mock_workflow_action_core(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

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
  draft_action_type TEXT;
  run_workflow_type TEXT;
  minimum_role TEXT := 'approver';
  expected_token_hash TEXT;
  token_revoked_at TIMESTAMPTZ;
  draft_found BOOLEAN;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT draft_row.action_type, run_row.workflow_type
  INTO draft_action_type, run_workflow_type
  FROM public.workflow_action_drafts draft_row
  JOIN public.workflow_runs run_row
    ON run_row.id = draft_row.workflow_run_id
    AND run_row.company_id = draft_row.company_id
  WHERE draft_row.id = p_action_draft_id
    AND draft_row.company_id = p_company_id;

  draft_found := FOUND;
  IF draft_found THEN
    SELECT policy.minimum_role
    INTO minimum_role
    FROM public.company_approval_policies policy
    WHERE policy.company_id = p_company_id
      AND policy.workflow_type = run_workflow_type
      AND policy.action_type = draft_action_type;

    minimum_role := COALESCE(minimum_role, 'approver');
    PERFORM workflow_private.require_company_role(p_company_id, minimum_role, current_user_id);
  END IF;

  expected_token_hash := encode(
    extensions.digest(convert_to(p_raw_token, 'UTF8'), 'sha256'),
    'hex'
  );

  SELECT token_row.revoked_at
  INTO token_revoked_at
  FROM public.workflow_execution_tokens token_row
  WHERE token_row.company_id = p_company_id
    AND token_row.action_draft_id = p_action_draft_id
    AND token_row.action_type = draft_action_type
    AND token_row.token_hash = expected_token_hash;

  IF FOUND AND token_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'token_revoked' USING ERRCODE = '55000';
  END IF;

  RETURN workflow_private.execute_mock_workflow_action_core(
    p_company_id,
    p_action_draft_id,
    p_decision_id,
    p_raw_token,
    p_idempotency_key,
    p_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_mock_workflow_action(
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

CREATE FUNCTION workflow_private.reissue_workflow_execution_token(
  p_company_id UUID,
  p_action_draft_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  draft_record public.workflow_action_drafts%ROWTYPE;
  run_record public.workflow_runs%ROWTYPE;
  decision_record public.workflow_decisions%ROWTYPE;
  token_record public.workflow_execution_tokens%ROWTYPE;
  minimum_role TEXT := 'approver';
  raw_token TEXT;
  revoked_token_ids JSONB := '[]'::JSONB;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL OR p_action_draft_id IS NULL THEN
    RAISE EXCEPTION 'invalid_token_reissue_request' USING ERRCODE = '22023';
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

  SELECT run_row.*
  INTO STRICT run_record
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

  IF EXISTS (
    SELECT 1
    FROM public.workflow_action_attempts attempt_row
    WHERE attempt_row.company_id = p_company_id
      AND attempt_row.action_draft_id = draft_record.id
  ) THEN
    RAISE EXCEPTION 'action_already_attempted' USING ERRCODE = '55000';
  END IF;

  IF draft_record.status <> 'approved' THEN
    RAISE EXCEPTION 'invalid_state' USING ERRCODE = '55000';
  END IF;

  SELECT decision_row.*
  INTO decision_record
  FROM public.workflow_decisions decision_row
  WHERE decision_row.company_id = p_company_id
    AND decision_row.action_draft_id = draft_record.id
    AND decision_row.decision IN ('approve', 'edit')
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'decision_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH revoked_tokens AS (
    UPDATE public.workflow_execution_tokens token_row
    SET revoked_at = now(),
        revoked_by = current_user_id
    WHERE token_row.company_id = p_company_id
      AND token_row.action_draft_id = draft_record.id
      AND token_row.consumed_at IS NULL
      AND token_row.revoked_at IS NULL
      AND token_row.expires_at > now()
    RETURNING token_row.id
  )
  SELECT COALESCE(jsonb_agg(revoked_tokens.id), '[]'::JSONB)
  INTO revoked_token_ids
  FROM revoked_tokens;

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
    draft_record.payload_hash,
    now() + interval '15 minutes',
    current_user_id
  )
  RETURNING * INTO token_record;

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
    draft_record.workflow_item_id,
    'execution_token_reissued',
    'Workflow execution capability reissued.',
    jsonb_build_object(
      'actionDraftId', draft_record.id,
      'decisionId', decision_record.id,
      'executionTokenId', token_record.id,
      'revokedExecutionTokenIds', revoked_token_ids,
      'payloadHash', draft_record.payload_hash
    ),
    jsonb_build_object(
      'langGraphThreadId', run_record.langgraph_thread_id,
      'langGraphCheckpointId', run_record.langgraph_checkpoint_id,
      'langSmithTraceId', run_record.langsmith_trace_id,
      'langSmithRunId', run_record.langsmith_run_id
    )
  );

  RETURN jsonb_build_object(
    'decisionId', decision_record.id,
    'executionToken', jsonb_build_object(
      'id', token_record.id,
      'rawToken', raw_token,
      'expiresAt', token_record.expires_at
    )
  );
END;
$$;

CREATE FUNCTION public.reissue_workflow_execution_token(
  p_company_id UUID,
  p_action_draft_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.reissue_workflow_execution_token(
    p_company_id,
    p_action_draft_id
  )
$$;

REVOKE ALL ON FUNCTION workflow_private.record_workflow_control_request(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.reject_revoked_workflow_execution_token_consumption()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.execute_mock_workflow_action(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.reissue_workflow_execution_token(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION workflow_private.record_workflow_control_request(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.execute_mock_workflow_action(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION workflow_private.reissue_workflow_execution_token(UUID, UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION public.record_workflow_control_request(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reissue_workflow_execution_token(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_mock_workflow_action(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_workflow_control_request(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, UUID, UUID, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_mock_workflow_action(
  UUID, UUID, UUID, TEXT, TEXT, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reissue_workflow_execution_token(UUID, UUID)
  TO authenticated;
