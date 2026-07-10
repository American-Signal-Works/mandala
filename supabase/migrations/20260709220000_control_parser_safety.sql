-- Complete conversational control-request lifecycles and bound parser cost.

CREATE TABLE workflow_private.workflow_control_parser_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  CONSTRAINT workflow_control_parser_leases_expiry_check
    CHECK (expires_at > created_at),
  CONSTRAINT workflow_control_parser_leases_release_check
    CHECK (released_at IS NULL OR released_at >= created_at)
);

CREATE TABLE workflow_private.workflow_control_request_bindings (
  control_request_id UUID PRIMARY KEY
    REFERENCES public.workflow_control_requests(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intent_digest TEXT NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workflow_private.workflow_control_parser_trust_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  token_digest TEXT NOT NULL CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  configured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workflow_control_request_bindings_actor_idx
  ON workflow_private.workflow_control_request_bindings (actor_id, created_at DESC);

CREATE FUNCTION public.configure_workflow_control_parser_trust(
  p_server_secret TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  server_token TEXT;
BEGIN
  IF p_server_secret IS NULL OR length(p_server_secret) < 32 THEN
    RAISE EXCEPTION 'invalid_parser_binding_secret' USING ERRCODE = '22023';
  END IF;

  server_token := encode(
    extensions.digest(convert_to(p_server_secret, 'UTF8'), 'sha256'),
    'hex'
  );
  INSERT INTO workflow_private.workflow_control_parser_trust_config (
    singleton,
    token_digest,
    configured_at
  )
  VALUES (
    true,
    encode(
      extensions.digest(convert_to(server_token, 'UTF8'), 'sha256'),
      'hex'
    ),
    now()
  )
  ON CONFLICT (singleton) DO UPDATE
  SET token_digest = EXCLUDED.token_digest,
      configured_at = EXCLUDED.configured_at;
END;
$$;

CREATE VIEW public.workflow_control_request_audit
WITH (security_barrier = true)
AS
SELECT
  request.id,
  request.company_id,
  request.actor_id,
  request.client_surface,
  request.normalized_intent,
  request.parser_kind,
  request.resolution_status,
  request.risk_class,
  request.workflow_run_id,
  request.workflow_item_id,
  request.langsmith_trace_id,
  request.langsmith_run_id,
  request.created_at,
  request.updated_at
FROM public.workflow_control_requests request
WHERE public.has_company_role(request.company_id, 'viewer');

CREATE INDEX workflow_control_parser_leases_actor_created_idx
  ON workflow_private.workflow_control_parser_leases (actor_id, created_at DESC);

CREATE INDEX workflow_control_parser_leases_company_created_idx
  ON workflow_private.workflow_control_parser_leases (company_id, created_at DESC);

CREATE FUNCTION workflow_private.to_json_pointer(p_path TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN cardinality(p_path) = 0 THEN ''
    ELSE '/' || string_agg(
      replace(replace(segment, '~', '~0'), '/', '~1'),
      '/' ORDER BY position
    )
  END
  FROM unnest(p_path) WITH ORDINALITY AS path_segment(segment, position)
$$;

CREATE FUNCTION workflow_private.json_pointer_to_path(p_pointer TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_pointer = '' THEN ARRAY[]::TEXT[]
    ELSE COALESCE(
      array_agg(
        replace(replace(segment, '~1', '/'), '~0', '~')
        ORDER BY position
      ),
      ARRAY[]::TEXT[]
    )
  END
  FROM unnest(string_to_array(substr(p_pointer, 2), '/'))
    WITH ORDINALITY AS pointer_segment(segment, position)
  WHERE p_pointer = '' OR left(p_pointer, 1) = '/'
$$;

CREATE FUNCTION workflow_private.jsonb_changed_pointers(
  p_before JSONB,
  p_after JSONB,
  p_path TEXT[]
)
RETURNS SETOF TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  before_type TEXT := jsonb_typeof(p_before);
  after_type TEXT := jsonb_typeof(p_after);
  segment TEXT;
BEGIN
  IF p_before IS NOT DISTINCT FROM p_after THEN
    RETURN;
  END IF;

  IF before_type = 'object' AND after_type = 'object' THEN
    FOR segment IN
      SELECT key_name
      FROM (
        SELECT jsonb_object_keys(p_before) AS key_name
        UNION
        SELECT jsonb_object_keys(p_after) AS key_name
      ) keys
      ORDER BY key_name
    LOOP
      IF NOT (p_before ? segment) OR NOT (p_after ? segment) THEN
        RETURN NEXT workflow_private.to_json_pointer(p_path || segment);
      ELSE
        RETURN QUERY
          SELECT changed.pointer
          FROM workflow_private.jsonb_changed_pointers(
            p_before -> segment,
            p_after -> segment,
            p_path || segment
          ) AS changed(pointer);
      END IF;
    END LOOP;
    RETURN;
  END IF;

  IF before_type = 'array' AND after_type = 'array' THEN
    IF jsonb_array_length(p_before) <> jsonb_array_length(p_after) THEN
      RETURN NEXT workflow_private.to_json_pointer(p_path);
      RETURN;
    END IF;
    IF jsonb_array_length(p_before) = 0 THEN
      RETURN;
    END IF;
    FOR index_value IN 0..jsonb_array_length(p_before) - 1 LOOP
      RETURN QUERY
        SELECT changed.pointer
        FROM workflow_private.jsonb_changed_pointers(
          p_before -> index_value,
          p_after -> index_value,
          p_path || index_value::TEXT
        ) AS changed(pointer);
    END LOOP;
    RETURN;
  END IF;

  RETURN NEXT workflow_private.to_json_pointer(p_path);
END;
$$;

CREATE FUNCTION public.record_workflow_control_request_with_binding(
  p_company_id UUID,
  p_client_surface TEXT,
  p_input_hash TEXT,
  p_normalized_intent JSONB,
  p_parser_kind TEXT,
  p_resolution_status TEXT,
  p_risk_class TEXT,
  p_binding_intent JSONB,
  p_server_token TEXT,
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
  control_request JSONB;
  intent_kind TEXT := p_normalized_intent ->> 'kind';
  normalized_pointers TEXT[];
  binding_pointers TEXT[];
  expected_token_digest TEXT;
  provided_token_digest TEXT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_resolution_status <> 'resolved'
    OR p_parser_kind NOT IN ('deterministic', 'langchain')
    OR p_binding_intent IS NULL
    OR jsonb_typeof(p_binding_intent) <> 'object'
    OR octet_length(p_binding_intent::TEXT) > 16384
    OR p_binding_intent ->> 'kind' IS DISTINCT FROM intent_kind
    OR p_binding_intent ->> 'companyId' IS DISTINCT FROM p_company_id::TEXT
    OR NOT workflow_private.is_safe_standalone_control_intent(
      p_company_id,
      p_normalized_intent,
      p_resolution_status,
      p_risk_class
    )
  THEN
    RAISE EXCEPTION 'invalid_control_request' USING ERRCODE = '22023';
  END IF;

  SELECT trust.token_digest
  INTO expected_token_digest
  FROM workflow_private.workflow_control_parser_trust_config trust
  WHERE trust.singleton;

  IF p_server_token IS NULL OR p_server_token !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'parser_binding_forbidden' USING ERRCODE = '42501';
  END IF;
  provided_token_digest := encode(
    extensions.digest(convert_to(p_server_token, 'UTF8'), 'sha256'),
    'hex'
  );
  IF expected_token_digest IS NULL
    OR provided_token_digest <> expected_token_digest
  THEN
    RAISE EXCEPTION 'parser_binding_forbidden' USING ERRCODE = '42501';
  END IF;

  CASE intent_kind
    WHEN 'run_fixture' THEN
      IF p_binding_intent - ARRAY['kind', 'companyId', 'scenarioId'] <> '{}'::JSONB
        OR p_binding_intent ->> 'scenarioId' IS DISTINCT FROM
          p_normalized_intent ->> 'scenarioId'
      THEN
        RAISE EXCEPTION 'invalid_control_request' USING ERRCODE = '22023';
      END IF;
    WHEN 'record_decision' THEN
      IF p_binding_intent - ARRAY[
          'kind', 'companyId', 'itemId', 'decision', 'patches',
          'warningsAcknowledged'
        ] <> '{}'::JSONB
        OR p_binding_intent ->> 'itemId' IS DISTINCT FROM
          p_normalized_intent ->> 'itemId'
        OR p_binding_intent ->> 'decision' IS DISTINCT FROM
          p_normalized_intent ->> 'decision'
        OR p_binding_intent -> 'warningsAcknowledged' IS DISTINCT FROM
          p_normalized_intent -> 'warningsAcknowledged'
        OR jsonb_typeof(p_binding_intent -> 'patches') <> 'array'
      THEN
        RAISE EXCEPTION 'invalid_control_request' USING ERRCODE = '22023';
      END IF;

      SELECT COALESCE(array_agg(pointer ORDER BY pointer), '{}'::TEXT[])
      INTO normalized_pointers
      FROM jsonb_array_elements_text(
        p_normalized_intent -> 'patchPointers'
      ) pointer;

      SELECT COALESCE(
        array_agg(patch ->> 'pointer' ORDER BY patch ->> 'pointer'),
        '{}'::TEXT[]
      )
      INTO binding_pointers
      FROM jsonb_array_elements(p_binding_intent -> 'patches') patch;

      IF binding_pointers IS DISTINCT FROM normalized_pointers
        OR cardinality(binding_pointers) IS DISTINCT FROM
          (p_normalized_intent ->> 'patchCount')::INTEGER
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_binding_intent -> 'patches') patch
          WHERE jsonb_typeof(patch) <> 'object'
            OR patch - ARRAY['pointer', 'value'] <> '{}'::JSONB
            OR jsonb_typeof(patch -> 'pointer') <> 'string'
            OR left(patch ->> 'pointer', 1) <> '/'
        )
      THEN
        RAISE EXCEPTION 'invalid_control_request' USING ERRCODE = '22023';
      END IF;
    WHEN 'execute_mock_action' THEN
      IF p_binding_intent - ARRAY['kind', 'companyId', 'itemId'] <> '{}'::JSONB
        OR p_binding_intent ->> 'itemId' IS DISTINCT FROM
          p_normalized_intent ->> 'itemId'
      THEN
        RAISE EXCEPTION 'invalid_control_request' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid_control_request' USING ERRCODE = '22023';
  END CASE;

  control_request := workflow_private.record_workflow_control_request(
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

  INSERT INTO workflow_private.workflow_control_request_bindings (
    control_request_id,
    company_id,
    actor_id,
    intent_digest
  )
  VALUES (
    (control_request ->> 'id')::UUID,
    p_company_id,
    current_user_id,
    encode(
      extensions.digest(
        convert_to(p_binding_intent::TEXT, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
  );

  RETURN control_request;
END;
$$;

CREATE FUNCTION workflow_private.assert_workflow_control_request_correlation(
  p_company_id UUID,
  p_control_request_id UUID,
  p_expected_kind TEXT,
  p_expected_item_id UUID DEFAULT NULL,
  p_expected_scenario_id TEXT DEFAULT NULL,
  p_expected_decision TEXT DEFAULT NULL,
  p_action_draft_id UUID DEFAULT NULL,
  p_edited_payload JSONB DEFAULT NULL,
  p_warnings_acknowledged BOOLEAN DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  control_request public.workflow_control_requests%ROWTYPE;
  action_draft public.workflow_action_drafts%ROWTYPE;
  binding_record workflow_private.workflow_control_request_bindings%ROWTYPE;
  expected_pointers TEXT[];
  actual_pointers TEXT[];
  actual_patches JSONB := '[]'::JSONB;
  actual_binding JSONB;
  actual_digest TEXT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT request_row.*
  INTO control_request
  FROM public.workflow_control_requests request_row
  WHERE request_row.id = p_control_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'control_request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF control_request.company_id <> p_company_id
    OR control_request.actor_id <> current_user_id
    OR control_request.parser_kind NOT IN ('deterministic', 'langchain')
    OR control_request.resolution_status <> 'resolved'
    OR control_request.normalized_intent ->> 'kind' <> p_expected_kind
  THEN
    RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
  END IF;

  SELECT binding.*
  INTO binding_record
  FROM workflow_private.workflow_control_request_bindings binding
  WHERE binding.control_request_id = p_control_request_id
    AND binding.company_id = p_company_id
    AND binding.actor_id = current_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
  END IF;

  IF p_expected_item_id IS NOT NULL
    AND control_request.normalized_intent ->> 'itemId'
      <> p_expected_item_id::TEXT
  THEN
    RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
  END IF;

  IF p_expected_scenario_id IS NOT NULL
    AND control_request.normalized_intent ->> 'scenarioId'
      <> p_expected_scenario_id
  THEN
    RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
  END IF;

  IF p_expected_decision IS NOT NULL
    AND control_request.normalized_intent ->> 'decision'
      <> p_expected_decision
  THEN
    RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
  END IF;

  IF p_action_draft_id IS NOT NULL THEN
    SELECT draft_row.*
    INTO action_draft
    FROM public.workflow_action_drafts draft_row
    WHERE draft_row.id = p_action_draft_id
      AND draft_row.company_id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'draft_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF control_request.normalized_intent ->> 'itemId'
      <> action_draft.workflow_item_id::TEXT
    THEN
      RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF p_expected_kind = 'record_decision' THEN
    SELECT COALESCE(array_agg(pointer ORDER BY pointer), '{}'::TEXT[])
    INTO expected_pointers
    FROM jsonb_array_elements_text(
      control_request.normalized_intent -> 'patchPointers'
    ) pointer;

    IF p_expected_decision = 'edit' THEN
      IF p_edited_payload IS NULL OR p_action_draft_id IS NULL THEN
        RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
      END IF;

      SELECT COALESCE(array_agg(pointer ORDER BY pointer), '{}'::TEXT[])
      INTO actual_pointers
      FROM workflow_private.jsonb_changed_pointers(
        action_draft.payload,
        p_edited_payload,
        ARRAY[]::TEXT[]
      ) pointer;

      IF actual_pointers IS DISTINCT FROM expected_pointers
        OR cardinality(actual_pointers) IS DISTINCT FROM
          (control_request.normalized_intent ->> 'patchCount')::INTEGER
      THEN
        RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
      END IF;

      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'pointer', pointer,
            'value', p_edited_payload #>
              workflow_private.json_pointer_to_path(pointer)
          )
          ORDER BY pointer
        ),
        '[]'::JSONB
      )
      INTO actual_patches
      FROM unnest(actual_pointers) pointer;
    ELSIF cardinality(expected_pointers) <> 0 OR p_edited_payload IS NOT NULL THEN
      RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  CASE p_expected_kind
    WHEN 'run_fixture' THEN
      actual_binding := jsonb_build_object(
        'kind', 'run_fixture',
        'companyId', p_company_id,
        'scenarioId', p_expected_scenario_id
      );
    WHEN 'record_decision' THEN
      actual_binding := jsonb_build_object(
        'kind', 'record_decision',
        'companyId', p_company_id,
        'itemId', action_draft.workflow_item_id,
        'decision', p_expected_decision,
        'patches', actual_patches,
        'warningsAcknowledged', COALESCE(p_warnings_acknowledged, false)
      );
    WHEN 'execute_mock_action' THEN
      actual_binding := jsonb_build_object(
        'kind', 'execute_mock_action',
        'companyId', p_company_id,
        'itemId', action_draft.workflow_item_id
      );
    ELSE
      RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
  END CASE;

  actual_digest := encode(
    extensions.digest(
      convert_to(actual_binding::TEXT, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  IF actual_digest <> binding_record.intent_digest THEN
    RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE FUNCTION workflow_private.transition_workflow_control_request_internal(
  p_company_id UUID,
  p_control_request_id UUID,
  p_resolution_status TEXT,
  p_expected_input_hash TEXT DEFAULT NULL,
  p_expected_kind TEXT DEFAULT NULL,
  p_workflow_run_id UUID DEFAULT NULL,
  p_workflow_item_id UUID DEFAULT NULL,
  p_allow_mutation_execution BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  control_request public.workflow_control_requests%ROWTYPE;
  linked_item public.workflow_items%ROWTYPE;
  linked_run public.workflow_runs%ROWTYPE;
  intent_kind TEXT;
  effective_workflow_item_id UUID;
  effective_workflow_run_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NULL
    OR p_control_request_id IS NULL
    OR p_resolution_status NOT IN ('executed', 'blocked', 'failed')
    OR (p_expected_input_hash IS NOT NULL AND p_expected_input_hash !~ '^[a-f0-9]{64}$')
  THEN
    RAISE EXCEPTION 'invalid_control_transition' USING ERRCODE = '22023';
  END IF;

  PERFORM workflow_private.require_company_role(
    p_company_id,
    'agent',
    current_user_id
  );

  SELECT request_row.*
  INTO control_request
  FROM public.workflow_control_requests request_row
  WHERE request_row.id = p_control_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'control_request_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF control_request.company_id <> p_company_id
    OR control_request.actor_id <> current_user_id
    OR control_request.parser_kind NOT IN ('deterministic', 'langchain')
  THEN
    RAISE EXCEPTION 'control_request_forbidden' USING ERRCODE = '42501';
  END IF;

  IF control_request.resolution_status <> 'resolved' THEN
    RAISE EXCEPTION 'invalid_control_transition' USING ERRCODE = '23514';
  END IF;

  IF p_expected_input_hash IS NOT NULL
    AND control_request.input_hash <> p_expected_input_hash
  THEN
    RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
  END IF;

  intent_kind := control_request.normalized_intent ->> 'kind';
  IF p_expected_kind IS NOT NULL AND intent_kind <> p_expected_kind THEN
    RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
  END IF;

  IF p_resolution_status = 'executed'
    AND control_request.risk_class <> 'read'
    AND NOT p_allow_mutation_execution
  THEN
    RAISE EXCEPTION 'invalid_control_transition' USING ERRCODE = '23514';
  END IF;

  effective_workflow_item_id := COALESCE(
    p_workflow_item_id,
    control_request.workflow_item_id
  );
  effective_workflow_run_id := COALESCE(
    p_workflow_run_id,
    control_request.workflow_run_id
  );

  IF effective_workflow_item_id IS NOT NULL THEN
    SELECT item_row.*
    INTO linked_item
    FROM public.workflow_items item_row
    WHERE item_row.id = effective_workflow_item_id
      AND item_row.company_id = p_company_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'linked_item_company_mismatch' USING ERRCODE = '22023';
    END IF;

    IF control_request.normalized_intent ? 'itemId'
      AND control_request.normalized_intent ->> 'itemId'
        <> effective_workflow_item_id::TEXT
    THEN
      RAISE EXCEPTION 'control_request_correlation_mismatch' USING ERRCODE = '23514';
    END IF;

    IF effective_workflow_run_id IS NULL THEN
      effective_workflow_run_id := linked_item.workflow_run_id;
    ELSIF effective_workflow_run_id <> linked_item.workflow_run_id THEN
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

  UPDATE public.workflow_control_requests request_row
  SET resolution_status = p_resolution_status,
      workflow_run_id = effective_workflow_run_id,
      workflow_item_id = effective_workflow_item_id
  WHERE request_row.id = p_control_request_id
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
      effective_workflow_item_id,
      'control_request_transitioned',
      'Workflow control request reached a terminal status.',
      jsonb_build_object(
        'controlRequestId', control_request.id,
        'intentKind', intent_kind,
        'resolutionStatus', control_request.resolution_status
      ),
      jsonb_build_object(
        'langGraphThreadId', linked_run.langgraph_thread_id,
        'langGraphCheckpointId', linked_run.langgraph_checkpoint_id,
        'langSmithTraceId', control_request.langsmith_trace_id,
        'langSmithRunId', control_request.langsmith_run_id
      )
    );
  END IF;

  RETURN to_jsonb(control_request);
END;
$$;

CREATE FUNCTION public.transition_workflow_control_request(
  p_company_id UUID,
  p_control_request_id UUID,
  p_resolution_status TEXT,
  p_workflow_run_id UUID DEFAULT NULL,
  p_workflow_item_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.transition_workflow_control_request_internal(
    p_company_id,
    p_control_request_id,
    p_resolution_status,
    NULL,
    NULL,
    p_workflow_run_id,
    p_workflow_item_id,
    false
  )
$$;

CREATE FUNCTION workflow_private.persist_workflow_fixture_run_controlled_reusing_request(
  p_payload JSONB,
  p_input_hash TEXT,
  p_client_surface TEXT,
  p_control_request_id UUID
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
    OR p_control_request_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_control_metadata' USING ERRCODE = '22023';
  END IF;

  PERFORM workflow_private.require_company_role(
    (p_payload ->> 'company_id')::UUID,
    'admin',
    current_user_id
  );

  PERFORM workflow_private.assert_workflow_control_request_correlation(
    (p_payload ->> 'company_id')::UUID,
    p_control_request_id,
    'run_fixture',
    NULL,
    p_payload #>> '{run,input,scenarioId}'
  );

  mutation_result := workflow_private.persist_workflow_fixture_run(p_payload);
  target_company_id := (mutation_result #>> '{run,company_id}')::UUID;
  workflow_run_id := (mutation_result #>> '{run,id}')::UUID;
  is_duplicate := COALESCE((mutation_result ->> 'duplicate')::BOOLEAN, false);
  IF NOT is_duplicate THEN
    workflow_item_id := NULLIF(mutation_result ->> 'itemId', '')::UUID;
  END IF;

  PERFORM workflow_private.transition_workflow_control_request_internal(
    target_company_id,
    p_control_request_id,
    'executed',
    NULL,
    'run_fixture',
    workflow_run_id,
    workflow_item_id,
    true
  );

  RETURN mutation_result;
END;
$$;

CREATE FUNCTION public.persist_workflow_fixture_run_controlled_reusing_request(
  p_payload JSONB,
  p_input_hash TEXT,
  p_client_surface TEXT,
  p_control_request_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.persist_workflow_fixture_run_controlled_reusing_request(
    p_payload,
    p_input_hash,
    p_client_surface,
    p_control_request_id
  )
$$;

CREATE FUNCTION workflow_private.record_workflow_decision_controlled_reusing_request(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision TEXT,
  p_input_hash TEXT,
  p_client_surface TEXT,
  p_control_request_id UUID,
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
  mutation_result JSONB;
  target_company_id UUID;
  workflow_run_id UUID;
  workflow_item_id UUID;
BEGIN
  IF p_input_hash IS NULL
    OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_client_surface IS NULL
    OR p_client_surface NOT IN ('cli', 'web', 'api', 'automation')
    OR p_control_request_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_control_metadata' USING ERRCODE = '22023';
  END IF;

  PERFORM workflow_private.assert_workflow_control_request_correlation(
    p_company_id,
    p_control_request_id,
    'record_decision',
    NULL,
    NULL,
    p_decision,
    p_action_draft_id,
    p_edited_payload,
    p_warnings_acknowledged
  );

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

  PERFORM workflow_private.transition_workflow_control_request_internal(
    target_company_id,
    p_control_request_id,
    'executed',
    NULL,
    'record_decision',
    workflow_run_id,
    workflow_item_id,
    true
  );

  RETURN mutation_result;
END;
$$;

CREATE FUNCTION public.record_workflow_decision_controlled_reusing_request(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision TEXT,
  p_input_hash TEXT,
  p_client_surface TEXT,
  p_control_request_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_warnings_acknowledged BOOLEAN DEFAULT false,
  p_edited_payload JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.record_workflow_decision_controlled_reusing_request(
    p_company_id,
    p_action_draft_id,
    p_decision,
    p_input_hash,
    p_client_surface,
    p_control_request_id,
    p_reason,
    p_warnings_acknowledged,
    p_edited_payload
  )
$$;

CREATE FUNCTION workflow_private.execute_mock_workflow_action_controlled_reusing_request(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision_id UUID,
  p_raw_token TEXT,
  p_idempotency_key TEXT,
  p_payload JSONB,
  p_input_hash TEXT,
  p_client_surface TEXT,
  p_control_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  mutation_result JSONB;
  target_company_id UUID;
  workflow_run_id UUID;
  workflow_item_id UUID;
BEGIN
  IF p_input_hash IS NULL
    OR p_input_hash !~ '^[a-f0-9]{64}$'
    OR p_client_surface IS NULL
    OR p_client_surface NOT IN ('cli', 'web', 'api', 'automation')
    OR p_control_request_id IS NULL
    OR p_idempotency_key IS NULL
    OR p_idempotency_key !~
      '^(cli|web|api):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RAISE EXCEPTION 'invalid_execution_request' USING ERRCODE = '22023';
  END IF;

  PERFORM workflow_private.assert_workflow_control_request_correlation(
    p_company_id,
    p_control_request_id,
    'execute_mock_action',
    NULL,
    NULL,
    NULL,
    p_action_draft_id,
    NULL
  );

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

  PERFORM workflow_private.transition_workflow_control_request_internal(
    target_company_id,
    p_control_request_id,
    'executed',
    NULL,
    'execute_mock_action',
    workflow_run_id,
    workflow_item_id,
    true
  );

  RETURN mutation_result;
END;
$$;

CREATE FUNCTION public.execute_mock_workflow_action_controlled_reusing_request(
  p_company_id UUID,
  p_action_draft_id UUID,
  p_decision_id UUID,
  p_raw_token TEXT,
  p_idempotency_key TEXT,
  p_payload JSONB,
  p_input_hash TEXT,
  p_client_surface TEXT,
  p_control_request_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.execute_mock_workflow_action_controlled_reusing_request(
    p_company_id,
    p_action_draft_id,
    p_decision_id,
    p_raw_token,
    p_idempotency_key,
    p_payload,
    p_input_hash,
    p_client_surface,
    p_control_request_id
  )
$$;

CREATE FUNCTION workflow_private.acquire_workflow_control_parser_lease(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  observed_at TIMESTAMPTZ := clock_timestamp();
  actor_requests INTEGER;
  company_requests INTEGER;
  actor_in_flight INTEGER;
  company_in_flight INTEGER;
  lease_record workflow_private.workflow_control_parser_leases%ROWTYPE;
BEGIN
  PERFORM workflow_private.require_company_role(
    p_company_id,
    'agent',
    current_user_id
  );

  PERFORM pg_advisory_xact_lock(1, hashtext(current_user_id::TEXT));
  PERFORM pg_advisory_xact_lock(2, hashtext(p_company_id::TEXT));

  DELETE FROM workflow_private.workflow_control_parser_leases lease
  WHERE lease.created_at < observed_at - INTERVAL '1 day';

  SELECT count(*)::INTEGER
  INTO actor_requests
  FROM workflow_private.workflow_control_parser_leases lease
  WHERE lease.actor_id = current_user_id
    AND lease.created_at >= observed_at - INTERVAL '1 minute';

  SELECT count(*)::INTEGER
  INTO company_requests
  FROM workflow_private.workflow_control_parser_leases lease
  WHERE lease.company_id = p_company_id
    AND lease.created_at >= observed_at - INTERVAL '1 minute';

  IF actor_requests >= 12 OR company_requests >= 30 THEN
    RAISE EXCEPTION 'parser_rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::INTEGER
  INTO actor_in_flight
  FROM workflow_private.workflow_control_parser_leases lease
  WHERE lease.actor_id = current_user_id
    AND lease.released_at IS NULL
    AND lease.expires_at > observed_at;

  SELECT count(*)::INTEGER
  INTO company_in_flight
  FROM workflow_private.workflow_control_parser_leases lease
  WHERE lease.company_id = p_company_id
    AND lease.released_at IS NULL
    AND lease.expires_at > observed_at;

  IF actor_in_flight >= 2 OR company_in_flight >= 6 THEN
    RAISE EXCEPTION 'parser_concurrency_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO workflow_private.workflow_control_parser_leases (
    company_id,
    actor_id,
    expires_at
  )
  VALUES (
    p_company_id,
    current_user_id,
    observed_at + INTERVAL '15 seconds'
  )
  RETURNING * INTO lease_record;

  RETURN jsonb_build_object(
    'leaseId', lease_record.id,
    'expiresAt', lease_record.expires_at
  );
END;
$$;

CREATE FUNCTION public.acquire_workflow_control_parser_lease(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.acquire_workflow_control_parser_lease(p_company_id)
$$;

CREATE FUNCTION workflow_private.release_workflow_control_parser_lease(
  p_company_id UUID,
  p_lease_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_user_id UUID := (SELECT auth.uid());
  lease_record workflow_private.workflow_control_parser_leases%ROWTYPE;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT lease.*
  INTO lease_record
  FROM workflow_private.workflow_control_parser_leases lease
  WHERE lease.id = p_lease_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'parser_lease_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF lease_record.company_id <> p_company_id
    OR lease_record.actor_id <> current_user_id
  THEN
    RAISE EXCEPTION 'parser_lease_forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE workflow_private.workflow_control_parser_leases lease
  SET released_at = COALESCE(lease.released_at, clock_timestamp())
  WHERE lease.id = p_lease_id;
END;
$$;

CREATE FUNCTION public.release_workflow_control_parser_lease(
  p_company_id UUID,
  p_lease_id UUID
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT workflow_private.release_workflow_control_parser_lease(
    p_company_id,
    p_lease_id
  )
$$;

REVOKE ALL ON TABLE workflow_private.workflow_control_parser_leases
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE workflow_private.workflow_control_request_bindings
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE workflow_private.workflow_control_parser_trust_config
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE SELECT ON TABLE public.workflow_control_requests FROM authenticated;
REVOKE ALL ON TABLE public.workflow_control_request_audit
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.workflow_control_request_audit TO authenticated;

REVOKE ALL ON FUNCTION workflow_private.to_json_pointer(TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.json_pointer_to_path(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.jsonb_changed_pointers(JSONB, JSONB, TEXT[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.assert_workflow_control_request_correlation(
  UUID, UUID, TEXT, UUID, TEXT, TEXT, UUID, JSONB, BOOLEAN
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.transition_workflow_control_request_internal(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, UUID, BOOLEAN
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.persist_workflow_fixture_run_controlled_reusing_request(
  JSONB, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.record_workflow_decision_controlled_reusing_request(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.execute_mock_workflow_action_controlled_reusing_request(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, UUID
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.acquire_workflow_control_parser_lease(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.release_workflow_control_parser_lease(UUID, UUID)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.transition_workflow_control_request(
  UUID, UUID, TEXT, UUID, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_workflow_control_request_with_binding(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, UUID, TEXT, TEXT
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configure_workflow_control_parser_trust(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_workflow_fixture_run_controlled_reusing_request(
  JSONB, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_workflow_decision_controlled_reusing_request(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, JSONB
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_mock_workflow_action_controlled_reusing_request(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, UUID
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.acquire_workflow_control_parser_lease(UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_workflow_control_parser_lease(UUID, UUID)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.transition_workflow_control_request(
  UUID, UUID, TEXT, UUID, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_control_request_with_binding(
  UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, JSONB, TEXT, UUID, UUID, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.configure_workflow_control_parser_trust(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_workflow_fixture_run_controlled_reusing_request(
  JSONB, TEXT, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_workflow_decision_controlled_reusing_request(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, JSONB
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_mock_workflow_action_controlled_reusing_request(
  UUID, UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, UUID
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_workflow_control_parser_lease(UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_workflow_control_parser_lease(UUID, UUID)
  TO authenticated;
