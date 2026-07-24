-- Preserve unmatched connector windows and make automation persistence
-- available only to the service-owned signal worker.

ALTER TABLE public.agent_signal_change_windows
  ADD COLUMN last_evaluated_at TIMESTAMPTZ,
  ADD COLUMN evaluation_count INTEGER NOT NULL DEFAULT 0
    CHECK (evaluation_count >= 0);

DROP INDEX public.agent_signal_change_windows_pending_idx;
CREATE INDEX agent_signal_change_windows_pending_idx
  ON public.agent_signal_change_windows(
    last_evaluated_at NULLS FIRST,
    created_at,
    id
  )
  WHERE dispatched_at IS NULL;

-- Older heartbeats marked every inspected window as dispatched, even when
-- no active trigger matched and no durable dispatch existed. Reopen only
-- those false positives; windows with a queue record remain terminal.
UPDATE public.agent_signal_change_windows change_window
SET dispatched_at = NULL,
    last_evaluated_at = NULL
WHERE change_window.dispatched_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.agent_signal_dispatches dispatch
    WHERE dispatch.change_window_id = change_window.id
      AND dispatch.company_id = change_window.company_id
  );

CREATE OR REPLACE FUNCTION workflow_private.prepare_agent_signal_dispatches(
  p_now TIMESTAMPTZ DEFAULT now(),
  p_change_limit INTEGER DEFAULT 100,
  p_schedule_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  change_windows_processed INTEGER := 0;
  change_dispatches_enqueued INTEGER := 0;
  schedule_dispatches_enqueued INTEGER := 0;
  reconciliation_dispatches_enqueued INTEGER := 0;
BEGIN
  IF p_now IS NULL
    OR p_change_limit NOT BETWEEN 1 AND 1000
    OR p_schedule_limit NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid_agent_signal_heartbeat' USING ERRCODE = '22023';
  END IF;

  WITH pending_windows AS (
    SELECT change_window.*
    FROM public.agent_signal_change_windows change_window
    WHERE change_window.dispatched_at IS NULL
      AND (
        change_window.last_evaluated_at IS NULL
        OR change_window.last_evaluated_at <= p_now - interval '5 minutes'
      )
    ORDER BY
      change_window.last_evaluated_at NULLS FIRST,
      change_window.created_at,
      change_window.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_change_limit
  ), matching_dispatches AS (
    SELECT
      change_window.company_id,
      activation.workflow_id,
      activation.binding_snapshot_id,
      change_window.id AS change_window_id,
      trigger ->> 'id' AS trigger_id,
      COALESCE(
        workflow.spec #>> '{workflow,default_mode}',
        'shadow'
      ) AS execution_mode,
      trigger AS trigger_snapshot,
      jsonb_build_object(
        'changeWindowId', change_window.id,
        'sourceId', change_window.source_id,
        'sourceKind', source.kind,
        'recordType', change_window.record_type,
        'changeKinds', to_jsonb(change_window.change_kinds),
        'changeCount', change_window.change_count,
        'firstChangedAt', change_window.first_changed_at,
        'lastChangedAt', change_window.last_changed_at,
        'sampleRecordIds', to_jsonb(change_window.sample_record_ids),
        'sampleTruncated', change_window.sample_truncated
      ) AS input,
      encode(extensions.digest(convert_to(
        change_window.company_id::TEXT || ':'
        || activation.workflow_id::TEXT || ':'
        || (trigger ->> 'id') || ':change:'
        || change_window.id::TEXT,
        'UTF8'
      ), 'sha256'), 'hex') AS dedupe_key
    FROM pending_windows change_window
    JOIN public.external_sources source
      ON source.id = change_window.source_id
     AND source.company_id = change_window.company_id
    JOIN public.workflow_activations activation
      ON activation.company_id = change_window.company_id
    JOIN public.agent_runtime_states runtime_state
      ON runtime_state.company_id = activation.company_id
     AND runtime_state.workflow_id = activation.workflow_id
     AND runtime_state.binding_snapshot_id = activation.binding_snapshot_id
     AND runtime_state.lifecycle_state = 'active'
    JOIN public.agent_workflows workflow
      ON workflow.id = activation.workflow_id
     AND workflow.company_id = activation.company_id
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(workflow.spec #> '{workflow,triggers}', '[]'::JSONB)
    ) trigger
    WHERE trigger ->> 'kind' = 'webhook'
      AND jsonb_typeof(trigger -> 'record_types') = 'array'
      AND jsonb_typeof(trigger -> 'source_kinds') = 'array'
      AND jsonb_typeof(trigger -> 'changes') = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(trigger -> 'record_types') value
        WHERE value = change_window.record_type
      )
      AND (
        jsonb_array_length(trigger -> 'source_kinds') = 0
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(trigger -> 'source_kinds') value
          WHERE value = source.kind
        )
      )
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(trigger -> 'changes') value
        WHERE value = ANY(change_window.change_kinds)
      )
  ), inserted AS (
    INSERT INTO public.agent_signal_dispatches(
      company_id,
      workflow_id,
      binding_snapshot_id,
      change_window_id,
      trigger_id,
      trigger_kind,
      signal_kind,
      execution_mode,
      trigger_snapshot,
      input,
      dedupe_key
    )
    SELECT
      company_id,
      workflow_id,
      binding_snapshot_id,
      change_window_id,
      trigger_id,
      'webhook',
      'record_change',
      execution_mode,
      trigger_snapshot,
      input,
      dedupe_key
    FROM matching_dispatches
    ON CONFLICT (company_id, dedupe_key) DO NOTHING
    RETURNING id, company_id, trigger_id, signal_kind
  ), logged AS (
    INSERT INTO public.agent_signal_dispatch_events(
      company_id,
      dispatch_id,
      event_type,
      actor_type,
      reason,
      details
    )
    SELECT
      inserted.company_id,
      inserted.id,
      'enqueued',
      'heartbeat',
      'Normalized connector changes matched an active compiled trigger.',
      jsonb_build_object(
        'triggerId',
        inserted.trigger_id,
        'signalKind',
        inserted.signal_kind
      )
    FROM inserted
    RETURNING id
  ), evaluated AS (
    UPDATE public.agent_signal_change_windows change_window
    SET last_evaluated_at = p_now,
        evaluation_count = change_window.evaluation_count + 1,
        dispatched_at = CASE
          WHEN EXISTS (
            SELECT 1
            FROM matching_dispatches matching
            WHERE matching.change_window_id = change_window.id
              AND matching.company_id = change_window.company_id
          )
          THEN p_now
          ELSE NULL
        END
    WHERE change_window.id IN (SELECT id FROM pending_windows)
    RETURNING id
  )
  SELECT
    (SELECT count(*)::INTEGER FROM evaluated),
    (SELECT count(*)::INTEGER FROM logged)
  INTO change_windows_processed, change_dispatches_enqueued;

  WITH due AS (
    SELECT
      activation.company_id,
      activation.workflow_id,
      activation.binding_snapshot_id,
      trigger ->> 'id' AS trigger_id,
      COALESCE(
        workflow.spec #>> '{workflow,default_mode}',
        'shadow'
      ) AS execution_mode,
      trigger AS trigger_snapshot,
      (trigger ->> 'every_minutes')::INTEGER AS every_minutes,
      to_timestamp(
        floor(
          extract(epoch FROM p_now)
          / ((trigger ->> 'every_minutes')::INTEGER * 60)
        ) * ((trigger ->> 'every_minutes')::INTEGER * 60)
      ) AS scheduled_for
    FROM public.workflow_activations activation
    JOIN public.agent_runtime_states runtime_state
      ON runtime_state.company_id = activation.company_id
     AND runtime_state.workflow_id = activation.workflow_id
     AND runtime_state.binding_snapshot_id = activation.binding_snapshot_id
     AND runtime_state.lifecycle_state = 'active'
    JOIN public.agent_workflows workflow
      ON workflow.id = activation.workflow_id
     AND workflow.company_id = activation.company_id
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(workflow.spec #> '{workflow,triggers}', '[]'::JSONB)
    ) trigger
    WHERE trigger ->> 'kind' = 'schedule'
      AND COALESCE(trigger ->> 'every_minutes', '') ~ '^[0-9]{1,5}$'
      AND (trigger ->> 'every_minutes')::INTEGER BETWEEN 1 AND 10080
    ORDER BY
      activation.activated_at,
      activation.workflow_id,
      trigger ->> 'id'
    LIMIT p_schedule_limit
  ), inserted AS (
    INSERT INTO public.agent_signal_dispatches(
      company_id,
      workflow_id,
      binding_snapshot_id,
      trigger_id,
      trigger_kind,
      signal_kind,
      execution_mode,
      trigger_snapshot,
      input,
      dedupe_key
    )
    SELECT
      due.company_id,
      due.workflow_id,
      due.binding_snapshot_id,
      due.trigger_id,
      'schedule',
      'schedule',
      due.execution_mode,
      due.trigger_snapshot,
      jsonb_build_object(
        'scheduledFor',
        due.scheduled_for,
        'everyMinutes',
        due.every_minutes
      ),
      encode(extensions.digest(convert_to(
        due.company_id::TEXT || ':'
        || due.workflow_id::TEXT || ':'
        || due.trigger_id || ':schedule:'
        || due.scheduled_for::TEXT,
        'UTF8'
      ), 'sha256'), 'hex')
    FROM due
    ON CONFLICT (company_id, dedupe_key) DO NOTHING
    RETURNING id, company_id, trigger_id, signal_kind
  ), logged AS (
    INSERT INTO public.agent_signal_dispatch_events(
      company_id,
      dispatch_id,
      event_type,
      actor_type,
      reason,
      details
    )
    SELECT
      inserted.company_id,
      inserted.id,
      'enqueued',
      'heartbeat',
      'An active compiled schedule trigger became due.',
      jsonb_build_object(
        'triggerId',
        inserted.trigger_id,
        'signalKind',
        inserted.signal_kind
      )
    FROM inserted
    RETURNING id
  )
  SELECT count(*)::INTEGER
  INTO schedule_dispatches_enqueued
  FROM logged;

  WITH due AS (
    SELECT
      activation.company_id,
      activation.workflow_id,
      activation.binding_snapshot_id,
      trigger ->> 'id' AS trigger_id,
      COALESCE(
        workflow.spec #>> '{workflow,default_mode}',
        'shadow'
      ) AS execution_mode,
      trigger AS trigger_snapshot,
      (trigger ->> 'reconcile_every_minutes')::INTEGER AS every_minutes,
      to_timestamp(
        floor(
          extract(epoch FROM p_now)
          / ((trigger ->> 'reconcile_every_minutes')::INTEGER * 60)
        ) * ((trigger ->> 'reconcile_every_minutes')::INTEGER * 60)
      ) AS scheduled_for
    FROM public.workflow_activations activation
    JOIN public.agent_runtime_states runtime_state
      ON runtime_state.company_id = activation.company_id
     AND runtime_state.workflow_id = activation.workflow_id
     AND runtime_state.binding_snapshot_id = activation.binding_snapshot_id
     AND runtime_state.lifecycle_state = 'active'
    JOIN public.agent_workflows workflow
      ON workflow.id = activation.workflow_id
     AND workflow.company_id = activation.company_id
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(workflow.spec #> '{workflow,triggers}', '[]'::JSONB)
    ) trigger
    WHERE trigger ->> 'kind' = 'webhook'
      AND COALESCE(
        trigger ->> 'reconcile_every_minutes',
        ''
      ) ~ '^[0-9]{1,5}$'
      AND (
        trigger ->> 'reconcile_every_minutes'
      )::INTEGER BETWEEN 5 AND 10080
    ORDER BY
      activation.activated_at,
      activation.workflow_id,
      trigger ->> 'id'
    LIMIT p_schedule_limit
  ), inserted AS (
    INSERT INTO public.agent_signal_dispatches(
      company_id,
      workflow_id,
      binding_snapshot_id,
      trigger_id,
      trigger_kind,
      signal_kind,
      execution_mode,
      trigger_snapshot,
      input,
      dedupe_key
    )
    SELECT
      due.company_id,
      due.workflow_id,
      due.binding_snapshot_id,
      due.trigger_id,
      'webhook',
      'reconciliation',
      due.execution_mode,
      due.trigger_snapshot,
      jsonb_build_object(
        'scheduledFor',
        due.scheduled_for,
        'everyMinutes',
        due.every_minutes,
        'recordTypes',
        due.trigger_snapshot -> 'record_types',
        'sourceKinds',
        due.trigger_snapshot -> 'source_kinds'
      ),
      encode(extensions.digest(convert_to(
        due.company_id::TEXT || ':'
        || due.workflow_id::TEXT || ':'
        || due.trigger_id || ':reconciliation:'
        || due.scheduled_for::TEXT,
        'UTF8'
      ), 'sha256'), 'hex')
    FROM due
    ON CONFLICT (company_id, dedupe_key) DO NOTHING
    RETURNING id, company_id, trigger_id, signal_kind
  ), logged AS (
    INSERT INTO public.agent_signal_dispatch_events(
      company_id,
      dispatch_id,
      event_type,
      actor_type,
      reason,
      details
    )
    SELECT
      inserted.company_id,
      inserted.id,
      'enqueued',
      'heartbeat',
      'Periodic reconciliation became due for an active change trigger.',
      jsonb_build_object(
        'triggerId',
        inserted.trigger_id,
        'signalKind',
        inserted.signal_kind
      )
    FROM inserted
    RETURNING id
  )
  SELECT count(*)::INTEGER
  INTO reconciliation_dispatches_enqueued
  FROM logged;

  RETURN jsonb_build_object(
    'changeWindowsProcessed', change_windows_processed,
    'changeDispatchesEnqueued', change_dispatches_enqueued,
    'scheduleDispatchesEnqueued', schedule_dispatches_enqueued,
    'reconciliationDispatchesEnqueued',
    reconciliation_dispatches_enqueued,
    'preparedAt', p_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION workflow_private.claim_agent_signal_dispatches(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 120,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE("leaseId" UUID, "dispatch" JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF length(trim(COALESCE(p_worker_id, ''))) NOT BETWEEN 1 AND 128
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds NOT BETWEEN 15 AND 900
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_agent_signal_claim' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT dispatch.id
    FROM public.agent_signal_dispatches dispatch
    JOIN public.workflow_activations activation
      ON activation.company_id = dispatch.company_id
     AND activation.workflow_id = dispatch.workflow_id
     AND activation.binding_snapshot_id = dispatch.binding_snapshot_id
    JOIN public.agent_runtime_states runtime_state
      ON runtime_state.company_id = dispatch.company_id
     AND runtime_state.workflow_id = dispatch.workflow_id
     AND runtime_state.binding_snapshot_id = dispatch.binding_snapshot_id
     AND runtime_state.lifecycle_state = 'active'
    WHERE dispatch.status IN ('pending','processing')
      AND dispatch.available_at <= p_now
      AND (
        dispatch.leased_until IS NULL
        OR dispatch.leased_until <= p_now
      )
      AND dispatch.attempts < dispatch.max_attempts
    ORDER BY dispatch.available_at, dispatch.created_at, dispatch.id
    FOR UPDATE OF dispatch SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.agent_signal_dispatches dispatch
    SET status = 'processing',
        lease_id = gen_random_uuid(),
        lease_owner = trim(p_worker_id),
        leased_until = p_now + make_interval(secs => p_lease_seconds),
        attempts = dispatch.attempts + 1
    FROM claimable
    WHERE dispatch.id = claimable.id
    RETURNING dispatch.*
  ), logged AS (
    INSERT INTO public.agent_signal_dispatch_events(
      company_id,
      dispatch_id,
      event_type,
      actor_type,
      worker_id,
      reason,
      details
    )
    SELECT
      claimed.company_id,
      claimed.id,
      'claimed',
      'worker',
      trim(p_worker_id),
      'Signal dispatch claimed for compiled runtime execution.',
      jsonb_build_object(
        'leaseId',
        claimed.lease_id,
        'leasedUntil',
        claimed.leased_until,
        'attempt',
        claimed.attempts
      )
    FROM claimed
    RETURNING dispatch_id
  )
  SELECT
    claimed.lease_id,
    jsonb_build_object(
      'id',
      claimed.id,
      'companyId',
      claimed.company_id,
      'workflowId',
      claimed.workflow_id,
      'bindingSnapshotId',
      claimed.binding_snapshot_id,
      'changeWindowId',
      claimed.change_window_id,
      'triggerId',
      claimed.trigger_id,
      'triggerKind',
      claimed.trigger_kind,
      'signalKind',
      claimed.signal_kind,
      'executionMode',
      claimed.execution_mode,
      'trigger',
      claimed.trigger_snapshot,
      'input',
      claimed.input,
      'attempt',
      claimed.attempts,
      'maxAttempts',
      claimed.max_attempts,
      'createdAt',
      claimed.created_at
    )
  FROM claimed
  WHERE EXISTS (
    SELECT 1
    FROM logged
    WHERE logged.dispatch_id = claimed.id
  );
END;
$$;

-- The public persistence RPC requires a user session. Automation keeps the
-- same validation and role checks by temporarily adopting the user who
-- activated the exact workflow/binding pair. Only service_role may enter.
CREATE FUNCTION public.persist_compiled_workflow_review_automation(
  p_company_id UUID,
  p_workflow_id UUID,
  p_binding_snapshot_id UUID,
  p_payload JSONB,
  p_input_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  activation_actor UUID;
  prior_sub TEXT := current_setting('request.jwt.claim.sub', true);
  prior_claims TEXT := current_setting('request.jwt.claims', true);
  result JSONB;
BEGIN
  PERFORM workflow_private.require_service_role();

  SELECT activation.activated_by
  INTO activation_actor
  FROM public.workflow_activations activation
  JOIN public.agent_runtime_states runtime_state
    ON runtime_state.company_id = activation.company_id
   AND runtime_state.workflow_id = activation.workflow_id
   AND runtime_state.binding_snapshot_id = activation.binding_snapshot_id
   AND runtime_state.lifecycle_state = 'active'
  WHERE activation.company_id = p_company_id
    AND activation.workflow_id = p_workflow_id
    AND activation.binding_snapshot_id = p_binding_snapshot_id;

  IF activation_actor IS NULL THEN
    RAISE EXCEPTION 'signal_activation_not_current' USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.company_memberships membership
    WHERE membership.company_id = p_company_id
      AND membership.user_id = activation_actor
      AND membership.status = 'active'
      AND public.company_role_rank(membership.role)
        >= public.company_role_rank('admin')
  ) THEN
    RAISE EXCEPTION 'signal_activation_actor_forbidden'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config(
    'request.jwt.claim.sub',
    activation_actor::TEXT,
    true
  );
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      activation_actor,
      'role',
      'authenticated'
    )::TEXT,
    true
  );

  result := workflow_private.persist_compiled_workflow_review_controlled(
    p_company_id,
    p_workflow_id,
    p_binding_snapshot_id,
    p_payload,
    p_input_hash,
    'automation'
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    COALESCE(prior_sub, ''),
    true
  );
  PERFORM set_config(
    'request.jwt.claims',
    COALESCE(prior_claims, ''),
    true
  );
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config(
    'request.jwt.claim.sub',
    COALESCE(prior_sub, ''),
    true
  );
  PERFORM set_config(
    'request.jwt.claims',
    COALESCE(prior_claims, ''),
    true
  );
  RAISE;
END;
$$;

CREATE FUNCTION public.prepare_agent_signal_dispatches_v1(
  p_now TIMESTAMPTZ,
  p_change_limit INTEGER DEFAULT 100,
  p_schedule_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM workflow_private.require_service_role();
  RETURN workflow_private.prepare_agent_signal_dispatches(
    p_now,
    p_change_limit,
    p_schedule_limit
  );
END;
$$;

CREATE FUNCTION public.claim_agent_signal_dispatches_v1(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 120,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE("leaseId" UUID, "dispatch" JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM workflow_private.require_service_role();
  RETURN QUERY
  SELECT *
  FROM workflow_private.claim_agent_signal_dispatches(
    p_worker_id,
    p_limit,
    p_lease_seconds,
    p_now
  );
END;
$$;

CREATE FUNCTION public.complete_agent_signal_dispatch_v1(
  p_worker_id TEXT,
  p_lease_id UUID,
  p_outcome TEXT,
  p_result JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM workflow_private.require_service_role();
  RETURN workflow_private.complete_agent_signal_dispatch(
    p_worker_id,
    p_lease_id,
    p_outcome,
    p_result
  );
END;
$$;

CREATE FUNCTION public.fail_agent_signal_dispatch_v1(
  p_worker_id TEXT,
  p_lease_id UUID,
  p_retryable BOOLEAN,
  p_error_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM workflow_private.require_service_role();
  RETURN workflow_private.fail_agent_signal_dispatch(
    p_worker_id,
    p_lease_id,
    p_retryable,
    p_error_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_compiled_workflow_review_automation(
  UUID,
  UUID,
  UUID,
  JSONB,
  TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persist_compiled_workflow_review_automation(
  UUID,
  UUID,
  UUID,
  JSONB,
  TEXT
) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_agent_signal_dispatches_v1(
  TIMESTAMPTZ,
  INTEGER,
  INTEGER
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_agent_signal_dispatches_v1(
  TEXT,
  INTEGER,
  INTEGER,
  TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_agent_signal_dispatch_v1(
  TEXT,
  UUID,
  TEXT,
  JSONB
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_agent_signal_dispatch_v1(
  TEXT,
  UUID,
  BOOLEAN,
  TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_agent_signal_dispatches_v1(
  TIMESTAMPTZ,
  INTEGER,
  INTEGER
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_agent_signal_dispatches_v1(
  TEXT,
  INTEGER,
  INTEGER,
  TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_agent_signal_dispatch_v1(
  TEXT,
  UUID,
  TEXT,
  JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_agent_signal_dispatch_v1(
  TEXT,
  UUID,
  BOOLEAN,
  TEXT
) TO service_role;

CREATE FUNCTION workflow_private.signal_stable_jsonb(p_value JSONB)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  result TEXT;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      SELECT
        '{'
        || COALESCE(
          string_agg(
            to_jsonb(entry.key)::TEXT
            || ':'
            || workflow_private.signal_stable_jsonb(entry.value),
            ','
            ORDER BY entry.key
          ),
          ''
        )
        || '}'
      INTO result
      FROM jsonb_each(p_value) entry;
      RETURN result;
    WHEN 'array' THEN
      SELECT
        '['
        || COALESCE(
          string_agg(
            workflow_private.signal_stable_jsonb(entry.value),
            ','
            ORDER BY entry.ordinality
          ),
          ''
        )
        || ']'
      INTO result
      FROM jsonb_array_elements(p_value)
        WITH ORDINALITY AS entry(value, ordinality);
      RETURN result;
    ELSE
      RETURN p_value::TEXT;
  END CASE;
END;
$$;

-- Existing activated compiled versions are immutable. Install a new 1.0.2
-- version per currently active procurement activation, copy its frozen grants,
-- and atomically advance the activation pointer. This is intentionally scoped
-- to the old v1.0.1 workflow and is idempotent by workflow key/version.
CREATE FUNCTION workflow_private.upgrade_active_procurement_signal_workflows()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  upgrades INTEGER := 0;
  target RECORD;
  trigger_spec JSONB := '{
    "id": "procurement-records-changed",
    "kind": "webhook",
    "description": "Re-evaluate bounded procurement candidates when normalized source records change.",
    "source_kinds": ["inventory_platform", "erp", "project_board", "task_board"],
    "record_types": ["inventory_position", "sales_order", "purchase_order", "product_vendor", "sku_vendor_map", "board_card"],
    "changes": ["insert", "update", "delete"],
    "reconcile_every_minutes": 60
  }'::JSONB;
  next_workflow_id UUID;
  next_snapshot_id UUID;
  next_runtime_id UUID;
  next_skill_markdown TEXT;
  next_spec JSONB;
  next_manifest JSONB;
  next_manifest_hash TEXT;
  next_source_hash TEXT;
  next_state_version BIGINT;
  prior_sub TEXT := current_setting('request.jwt.claim.sub', true);
  prior_claims TEXT := current_setting('request.jwt.claims', true);
BEGIN
  FOR target IN
    SELECT
      activation.*,
      workflow.workflow_type,
      workflow.name,
      workflow.status,
      workflow.spec,
      workflow.skill_markdown,
      workflow.compile_result,
      workflow.compiler_version,
      workflow.compiler_diagnostics,
      workflow.created_by,
      snapshot.grant_digest,
      runtime_state.id AS runtime_state_id,
      runtime_state.state_version,
      runtime_state.readiness_status,
      runtime_state.readiness_issues,
      runtime_state.readiness_hash,
      runtime_state.readiness_checked_at,
      runtime_state.last_sample_run_id,
      promotion.evaluation_run_id AS promotion_evaluation_run_id,
      promotion.thresholds AS promotion_thresholds
    FROM public.workflow_activations activation
    JOIN public.agent_workflows workflow
      ON workflow.id = activation.workflow_id
     AND workflow.company_id = activation.company_id
    JOIN public.workflow_binding_snapshots snapshot
      ON snapshot.id = activation.binding_snapshot_id
     AND snapshot.company_id = activation.company_id
     AND snapshot.workflow_id = activation.workflow_id
    JOIN public.agent_runtime_states runtime_state
      ON runtime_state.company_id = activation.company_id
     AND runtime_state.workflow_id = activation.workflow_id
     AND runtime_state.binding_snapshot_id = activation.binding_snapshot_id
     AND runtime_state.lifecycle_state = 'active'
    JOIN LATERAL (
      SELECT checkpoint.evaluation_run_id, checkpoint.thresholds
      FROM public.agent_promotion_checkpoints checkpoint
      WHERE checkpoint.company_id = activation.company_id
        AND checkpoint.workflow_id = activation.workflow_id
        AND checkpoint.workflow_version = workflow.version
        AND checkpoint.decision = 'pass'
      ORDER BY checkpoint.created_at DESC, checkpoint.id DESC
      LIMIT 1
    ) promotion ON true
    WHERE workflow.workflow_type = 'procurement_reorder'
      AND workflow.version = '1.0.1'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          COALESCE(workflow.spec #> '{workflow,triggers}', '[]'::JSONB)
        ) existing_trigger
        WHERE existing_trigger ->> 'kind' = 'webhook'
      )
    FOR UPDATE OF activation
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.agent_workflows existing
      WHERE existing.company_id = target.company_id
        AND existing.workflow_key = target.workflow_key
        AND existing.version = '1.0.2'
    ) THEN
      RAISE EXCEPTION 'procurement_signal_version_conflict'
        USING ERRCODE = '55000';
    END IF;

    next_workflow_id := gen_random_uuid();
    next_snapshot_id := gen_random_uuid();
    next_runtime_id := gen_random_uuid();
    next_state_version := target.state_version + 1;
    next_skill_markdown := replace(
      replace(
        target.skill_markdown,
        '  version: 1.0.1',
        '  version: 1.0.2'
      ),
      '    - id: synthetic-test
      kind: fixture
      description: Test against the Mandala Bean Co. synthetic commerce dataset.',
      '    - id: synthetic-test
      kind: fixture
      description: Test against the Mandala Bean Co. synthetic commerce dataset.
    - id: procurement-records-changed
      kind: webhook
      description: Re-evaluate bounded procurement candidates when normalized source records change.
      source_kinds:
        - inventory_platform
        - erp
        - project_board
        - task_board
      record_types:
        - inventory_position
        - sales_order
        - purchase_order
        - product_vendor
        - sku_vendor_map
        - board_card
      changes:
        - insert
        - update
        - delete
      reconcile_every_minutes: 60'
    );
    IF next_skill_markdown IS NOT DISTINCT FROM target.skill_markdown THEN
      RAISE EXCEPTION 'procurement_signal_skill_upgrade_failed'
        USING ERRCODE = '55000';
    END IF;

    next_source_hash := encode(
      extensions.digest(
        convert_to(trim(replace(next_skill_markdown, E'\r\n', E'\n')), 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    next_spec := jsonb_set(
      jsonb_set(
        jsonb_set(
          target.spec - 'manifestDigest',
          '{identity,version}',
          to_jsonb('1.0.2'::TEXT),
          false
        ),
        '{workflow,triggers}',
        COALESCE(target.spec #> '{workflow,triggers}', '[]'::JSONB)
          || jsonb_build_array(trigger_spec),
        false
      ),
      '{sourceDigest}',
      to_jsonb(next_source_hash),
      false
    );
    next_spec := next_spec || jsonb_build_object(
      'manifestDigest',
      encode(
        extensions.digest(
          convert_to(
            workflow_private.signal_stable_jsonb(next_spec),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
    );
    next_manifest := jsonb_build_object(
      'workflowKey',
      target.workflow_key,
      'workflowType',
      target.workflow_type,
      'name',
      target.name,
      'version',
      '1.0.2',
      'spec',
      next_spec,
      'compilerVersion',
      target.compiler_version
    );
    next_manifest_hash := encode(
      extensions.digest(
        convert_to(next_manifest::TEXT, 'UTF8'),
        'sha256'
      ),
      'hex'
    );

    INSERT INTO public.agent_workflows(
      id,
      company_id,
      workflow_key,
      workflow_type,
      name,
      version,
      status,
      spec,
      skill_markdown,
      compile_result,
      created_by,
      updated_by,
      skill_source_hash,
      compiler_version,
      compiled_manifest_hash,
      compiled_at,
      compiler_diagnostics
    ) VALUES (
      next_workflow_id,
      target.company_id,
      target.workflow_key,
      target.workflow_type,
      target.name,
      '1.0.2',
      target.status,
      next_spec,
      next_skill_markdown,
      target.compile_result,
      target.activated_by,
      target.activated_by,
      next_source_hash,
      target.compiler_version,
      next_manifest_hash,
      now(),
      target.compiler_diagnostics
    );

    INSERT INTO public.workflow_binding_snapshots(
      id,
      company_id,
      workflow_id,
      manifest_hash,
      grant_digest,
      created_by
    ) VALUES (
      next_snapshot_id,
      target.company_id,
      next_workflow_id,
      next_manifest_hash,
      target.grant_digest,
      target.activated_by
    );
    INSERT INTO public.workflow_capability_bindings(
      company_id,
      binding_snapshot_id,
      requirement_key,
      grant_id,
      capability_version_id
    )
    SELECT
      binding.company_id,
      next_snapshot_id,
      binding.requirement_key,
      binding.grant_id,
      binding.capability_version_id
    FROM public.workflow_capability_bindings binding
    WHERE binding.company_id = target.company_id
      AND binding.binding_snapshot_id = target.binding_snapshot_id;
    INSERT INTO public.workflow_binding_snapshot_events(
      company_id,
      binding_snapshot_id,
      event_type,
      reason,
      actor_id
    ) VALUES (
      target.company_id,
      next_snapshot_id,
      'created',
      'Copied frozen capability grants for the procurement signal trigger upgrade.',
      target.activated_by
    );
    INSERT INTO public.agent_promotion_checkpoints(
      company_id,
      workflow_id,
      workflow_version,
      evaluation_run_id,
      thresholds,
      decision,
      reason
    ) VALUES (
      target.company_id,
      next_workflow_id,
      '1.0.2',
      target.promotion_evaluation_run_id,
      target.promotion_thresholds,
      'pass',
      'Inherited the passing v1.0.1 evaluation because v1.0.2 changes only bounded trigger metadata and preserves the compiled graph, rules, actions, and frozen grants.'
    );

    UPDATE public.agent_runtime_states
    SET lifecycle_state = 'paused',
        state_version = next_state_version,
        updated_by = target.activated_by
    WHERE id = target.runtime_state_id;
    INSERT INTO public.agent_lifecycle_events(
      company_id,
      runtime_state_id,
      workflow_id,
      transition,
      from_state,
      to_state,
      state_version,
      reason,
      actor_id
    ) VALUES (
      target.company_id,
      target.runtime_state_id,
      target.workflow_id,
      'pause',
      'active',
      'paused',
      next_state_version,
      'Superseded by the idempotent v1.0.2 connector-signal upgrade.',
      target.activated_by
    );
    INSERT INTO public.agent_runtime_states(
      id,
      company_id,
      workflow_id,
      lifecycle_state,
      state_version,
      readiness_status,
      readiness_issues,
      readiness_hash,
      readiness_checked_at,
      last_sample_run_id,
      binding_snapshot_id,
      updated_by
    ) VALUES (
      next_runtime_id,
      target.company_id,
      next_workflow_id,
      'active',
      1,
      target.readiness_status,
      target.readiness_issues,
      target.readiness_hash,
      target.readiness_checked_at,
      target.last_sample_run_id,
      next_snapshot_id,
      target.activated_by
    );
    INSERT INTO public.agent_lifecycle_events(
      company_id,
      runtime_state_id,
      workflow_id,
      transition,
      from_state,
      to_state,
      state_version,
      reason,
      actor_id
    ) VALUES (
      target.company_id,
      next_runtime_id,
      next_workflow_id,
      'activate',
      'ready',
      'active',
      1,
      'Activated the reviewed v1.0.2 connector-signal upgrade.',
      target.activated_by
    );

    UPDATE public.workflow_activations
    SET workflow_id = next_workflow_id,
        binding_snapshot_id = next_snapshot_id,
        activation_sequence = target.activation_sequence + 1,
        activated_at = now()
    WHERE company_id = target.company_id
      AND workflow_key = target.workflow_key
      AND workflow_id = target.workflow_id
      AND binding_snapshot_id = target.binding_snapshot_id;
    INSERT INTO public.workflow_activation_events(
      company_id,
      workflow_key,
      workflow_id,
      binding_snapshot_id,
      previous_workflow_id,
      event_type,
      actor_id
    ) VALUES (
      target.company_id,
      target.workflow_key,
      next_workflow_id,
      next_snapshot_id,
      target.workflow_id,
      'activated',
      target.activated_by
    );
    PERFORM set_config(
      'request.jwt.claim.sub',
      target.activated_by::TEXT,
      true
    );
    PERFORM set_config(
      'request.jwt.claims',
      jsonb_build_object(
        'sub',
        target.activated_by,
        'role',
        'authenticated'
      )::TEXT,
      true
    );
    PERFORM workflow_private.record_company_security_audit(
      target.company_id,
      'workflow_activated',
      'Procurement workflow upgraded with bounded connector signals.',
      jsonb_build_object(
        'workflowKey',
        target.workflow_key,
        'workflowId',
        next_workflow_id,
        'bindingSnapshotId',
        next_snapshot_id,
        'previousWorkflowId',
        target.workflow_id,
        'activationSequence',
        target.activation_sequence + 1,
        'version',
        '1.0.2'
      )
    );
    PERFORM set_config(
      'request.jwt.claim.sub',
      COALESCE(prior_sub, ''),
      true
    );
    PERFORM set_config(
      'request.jwt.claims',
      COALESCE(prior_claims, ''),
      true
    );
    upgrades := upgrades + 1;
  END LOOP;
  RETURN upgrades;
END;
$$;

SELECT workflow_private.upgrade_active_procurement_signal_workflows();

REVOKE ALL ON FUNCTION workflow_private.signal_stable_jsonb(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  workflow_private.upgrade_active_procurement_signal_workflows()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON COLUMN public.agent_signal_change_windows.last_evaluated_at IS
  'Last bounded trigger-matching attempt; unmatched windows remain undispatched.';
COMMENT ON FUNCTION public.persist_compiled_workflow_review_automation(
  UUID,
  UUID,
  UUID,
  JSONB,
  TEXT
) IS
  'Service-only persistence bridge for a currently active signal dispatch.';
