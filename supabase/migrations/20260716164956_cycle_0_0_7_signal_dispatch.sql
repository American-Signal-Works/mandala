-- Cycle 0.0.7: generic signal dispatch and reconciliation heartbeat.
--
-- The skill compiler already defines deterministic rules and workflow graphs.
-- This migration supplies the durable, tenant-scoped heartbeat that turns
-- normalized connector changes and interval triggers into bounded dispatch
-- work. Connector writes are coalesced by transaction/source/record type so a
-- bulk sync creates a small number of windows instead of one job per record.

CREATE TABLE public.agent_signal_change_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_id UUID NOT NULL,
  record_type TEXT NOT NULL CHECK (
    length(record_type) BETWEEN 1 AND 150
    AND record_type ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  transaction_id BIGINT NOT NULL,
  change_kinds TEXT[] NOT NULL CHECK (
    cardinality(change_kinds) BETWEEN 1 AND 3
    AND change_kinds <@ ARRAY['insert','update','delete']::TEXT[]
  ),
  change_count INTEGER NOT NULL DEFAULT 1 CHECK (change_count > 0),
  sample_record_ids UUID[] NOT NULL DEFAULT '{}'::UUID[] CHECK (
    cardinality(sample_record_ids) <= 100
  ),
  sample_truncated BOOLEAN NOT NULL DEFAULT false,
  first_changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  dispatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_id, record_type, transaction_id),
  UNIQUE (id, company_id),
  FOREIGN KEY (source_id, company_id)
    REFERENCES public.external_sources(id, company_id) ON DELETE CASCADE,
  CHECK (last_changed_at >= first_changed_at)
);

CREATE TABLE public.agent_signal_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL,
  binding_snapshot_id UUID NOT NULL,
  change_window_id UUID,
  trigger_id TEXT NOT NULL CHECK (
    trigger_id ~ '^[a-z0-9][a-z0-9._-]*$'
    AND length(trigger_id) <= 150
  ),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('schedule','webhook')),
  signal_kind TEXT NOT NULL CHECK (
    signal_kind IN ('record_change','schedule','reconciliation')
  ),
  execution_mode TEXT NOT NULL CHECK (
    execution_mode IN ('mock','dry_run','shadow')
  ),
  trigger_snapshot JSONB NOT NULL CHECK (
    jsonb_typeof(trigger_snapshot) = 'object'
    AND pg_column_size(trigger_snapshot) <= 32768
  ),
  input JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (
    jsonb_typeof(input) = 'object'
    AND pg_column_size(input) <= 65536
  ),
  dedupe_key TEXT NOT NULL CHECK (dedupe_key ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','processing','completed','suppressed','dead_letter')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_id UUID,
  lease_owner TEXT CHECK (
    lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 128
  ),
  leased_until TIMESTAMPTZ,
  result JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (
    jsonb_typeof(result) = 'object'
    AND pg_column_size(result) <= 65536
  ),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, dedupe_key),
  UNIQUE (id, company_id),
  FOREIGN KEY (workflow_id, company_id)
    REFERENCES public.agent_workflows(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (binding_snapshot_id, company_id, workflow_id)
    REFERENCES public.workflow_binding_snapshots(id, company_id, workflow_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (change_window_id, company_id)
    REFERENCES public.agent_signal_change_windows(id, company_id) ON DELETE RESTRICT,
  CHECK (
    (signal_kind = 'record_change' AND change_window_id IS NOT NULL AND trigger_kind = 'webhook')
    OR (signal_kind IN ('schedule','reconciliation') AND change_window_id IS NULL)
  ),
  CHECK (
    (lease_id IS NULL AND lease_owner IS NULL AND leased_until IS NULL)
    OR (lease_id IS NOT NULL AND lease_owner IS NOT NULL AND leased_until IS NOT NULL)
  ),
  CHECK (
    (status IN ('completed','suppressed','dead_letter') AND completed_at IS NOT NULL)
    OR (status IN ('pending','processing') AND completed_at IS NULL)
  )
);

CREATE TABLE public.agent_signal_dispatch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  dispatch_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('enqueued','claimed','completed','suppressed','retry_scheduled','dead_letter')
  ),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('heartbeat','worker','system')),
  worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 128),
  reason TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 1000),
  details JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (
    jsonb_typeof(details) = 'object'
    AND pg_column_size(details) <= 16384
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  FOREIGN KEY (dispatch_id, company_id)
    REFERENCES public.agent_signal_dispatches(id, company_id) ON DELETE CASCADE,
  CHECK (
    (actor_type = 'worker' AND worker_id IS NOT NULL)
    OR (actor_type <> 'worker' AND worker_id IS NULL)
  )
);

CREATE INDEX agent_signal_change_windows_pending_idx
  ON public.agent_signal_change_windows(created_at, id)
  WHERE dispatched_at IS NULL;
CREATE INDEX agent_signal_dispatches_claim_idx
  ON public.agent_signal_dispatches(status, available_at, created_at, id)
  WHERE status IN ('pending','processing');
CREATE INDEX agent_signal_dispatches_workflow_idx
  ON public.agent_signal_dispatches(company_id, workflow_id, created_at DESC);
CREATE INDEX agent_signal_dispatch_events_dispatch_idx
  ON public.agent_signal_dispatch_events(company_id, dispatch_id, event_sequence);

CREATE TRIGGER agent_signal_change_windows_touch
BEFORE UPDATE ON public.agent_signal_change_windows
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER agent_signal_dispatches_touch
BEFORE UPDATE ON public.agent_signal_dispatches
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.agent_signal_change_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_signal_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_signal_dispatch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_signal_change_windows_member_select
  ON public.agent_signal_change_windows FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_signal_dispatches_member_select
  ON public.agent_signal_dispatches FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));
CREATE POLICY agent_signal_dispatch_events_member_select
  ON public.agent_signal_dispatch_events FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

REVOKE ALL ON
  public.agent_signal_change_windows,
  public.agent_signal_dispatches,
  public.agent_signal_dispatch_events
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON
  public.agent_signal_change_windows,
  public.agent_signal_dispatches,
  public.agent_signal_dispatch_events
TO authenticated;

GRANT ALL ON
  public.agent_signal_change_windows,
  public.agent_signal_dispatches,
  public.agent_signal_dispatch_events
TO service_role;

CREATE FUNCTION workflow_private.capture_external_record_change_window()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target public.external_records%ROWTYPE;
  changed_at TIMESTAMPTZ := clock_timestamp();
  change_kind TEXT := lower(TG_OP);
BEGIN
  IF TG_OP = 'DELETE' THEN
    target := OLD;
  ELSE
    target := NEW;
  END IF;

  INSERT INTO public.agent_signal_change_windows(
    company_id, source_id, record_type, transaction_id, change_kinds,
    change_count, sample_record_ids, first_changed_at, last_changed_at
  ) VALUES (
    target.company_id, target.source_id, target.record_type, txid_current(),
    ARRAY[change_kind], 1, ARRAY[target.id], changed_at, changed_at
  )
  ON CONFLICT (company_id, source_id, record_type, transaction_id)
  DO UPDATE SET
    change_kinds = ARRAY(
      SELECT DISTINCT value
      FROM unnest(
        public.agent_signal_change_windows.change_kinds || ARRAY[change_kind]
      ) value
      ORDER BY value
    ),
    change_count = public.agent_signal_change_windows.change_count + 1,
    sample_record_ids = CASE
      WHEN cardinality(public.agent_signal_change_windows.sample_record_ids) < 100
        AND NOT target.id = ANY(public.agent_signal_change_windows.sample_record_ids)
      THEN public.agent_signal_change_windows.sample_record_ids || target.id
      ELSE public.agent_signal_change_windows.sample_record_ids
    END,
    sample_truncated = public.agent_signal_change_windows.sample_truncated
      OR cardinality(public.agent_signal_change_windows.sample_record_ids) >= 100,
    last_changed_at = changed_at;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER external_records_capture_signal_change
AFTER INSERT OR UPDATE OR DELETE ON public.external_records
FOR EACH ROW EXECUTE FUNCTION workflow_private.capture_external_record_change_window();

CREATE FUNCTION workflow_private.reject_agent_signal_dispatch_event_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'agent_signal_dispatch_history_immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER agent_signal_dispatch_events_immutable
BEFORE UPDATE OR DELETE ON public.agent_signal_dispatch_events
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_agent_signal_dispatch_event_change();

CREATE FUNCTION workflow_private.prepare_agent_signal_dispatches(
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
    ORDER BY change_window.created_at, change_window.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_change_limit
  ), matching_dispatches AS (
    SELECT
      change_window.company_id,
      activation.workflow_id,
      activation.binding_snapshot_id,
      change_window.id AS change_window_id,
      trigger ->> 'id' AS trigger_id,
      COALESCE(workflow.spec #>> '{workflow,default_mode}', 'shadow') AS execution_mode,
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
        change_window.company_id::TEXT || ':' || activation.workflow_id::TEXT || ':'
        || (trigger ->> 'id') || ':change:' || change_window.id::TEXT,
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
        SELECT 1 FROM jsonb_array_elements_text(trigger -> 'record_types') value
        WHERE value = change_window.record_type
      )
      AND (
        jsonb_array_length(trigger -> 'source_kinds') = 0
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(trigger -> 'source_kinds') value
          WHERE value = source.kind
        )
      )
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(trigger -> 'changes') value
        WHERE value = ANY(change_window.change_kinds)
      )
  ), inserted AS (
    INSERT INTO public.agent_signal_dispatches(
      company_id, workflow_id, binding_snapshot_id, change_window_id,
      trigger_id, trigger_kind, signal_kind, execution_mode,
      trigger_snapshot, input, dedupe_key
    )
    SELECT
      company_id, workflow_id, binding_snapshot_id, change_window_id,
      trigger_id, 'webhook', 'record_change', execution_mode,
      trigger_snapshot, input, dedupe_key
    FROM matching_dispatches
    ON CONFLICT (company_id, dedupe_key) DO NOTHING
    RETURNING id, company_id, trigger_id, signal_kind
  ), logged AS (
    INSERT INTO public.agent_signal_dispatch_events(
      company_id, dispatch_id, event_type, actor_type, reason, details
    )
    SELECT
      inserted.company_id, inserted.id, 'enqueued', 'heartbeat',
      'Normalized connector changes matched an active compiled trigger.',
      jsonb_build_object('triggerId', inserted.trigger_id, 'signalKind', inserted.signal_kind)
    FROM inserted
    RETURNING id
  ), marked AS (
    UPDATE public.agent_signal_change_windows change_window
    SET dispatched_at = p_now
    WHERE change_window.id IN (SELECT id FROM pending_windows)
    RETURNING id
  )
  SELECT
    (SELECT count(*)::INTEGER FROM marked),
    (SELECT count(*)::INTEGER FROM logged)
  INTO change_windows_processed, change_dispatches_enqueued;

  WITH due AS (
    SELECT
      activation.company_id,
      activation.workflow_id,
      activation.binding_snapshot_id,
      trigger ->> 'id' AS trigger_id,
      COALESCE(workflow.spec #>> '{workflow,default_mode}', 'shadow') AS execution_mode,
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
    ORDER BY activation.activated_at, activation.workflow_id, trigger ->> 'id'
    LIMIT p_schedule_limit
  ), inserted AS (
    INSERT INTO public.agent_signal_dispatches(
      company_id, workflow_id, binding_snapshot_id, trigger_id, trigger_kind,
      signal_kind, execution_mode, trigger_snapshot, input, dedupe_key
    )
    SELECT
      due.company_id, due.workflow_id, due.binding_snapshot_id, due.trigger_id,
      'schedule', 'schedule', due.execution_mode, due.trigger_snapshot,
      jsonb_build_object(
        'scheduledFor', due.scheduled_for,
        'everyMinutes', due.every_minutes
      ),
      encode(extensions.digest(convert_to(
        due.company_id::TEXT || ':' || due.workflow_id::TEXT || ':'
        || due.trigger_id || ':schedule:' || due.scheduled_for::TEXT,
        'UTF8'
      ), 'sha256'), 'hex')
    FROM due
    ON CONFLICT (company_id, dedupe_key) DO NOTHING
    RETURNING id, company_id, trigger_id, signal_kind
  ), logged AS (
    INSERT INTO public.agent_signal_dispatch_events(
      company_id, dispatch_id, event_type, actor_type, reason, details
    )
    SELECT
      inserted.company_id, inserted.id, 'enqueued', 'heartbeat',
      'An active compiled schedule trigger became due.',
      jsonb_build_object('triggerId', inserted.trigger_id, 'signalKind', inserted.signal_kind)
    FROM inserted
    RETURNING id
  )
  SELECT count(*)::INTEGER INTO schedule_dispatches_enqueued FROM logged;

  WITH due AS (
    SELECT
      activation.company_id,
      activation.workflow_id,
      activation.binding_snapshot_id,
      trigger ->> 'id' AS trigger_id,
      COALESCE(workflow.spec #>> '{workflow,default_mode}', 'shadow') AS execution_mode,
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
     AND runtime_state.lifecycle_state = 'active'
    JOIN public.agent_workflows workflow
      ON workflow.id = activation.workflow_id
     AND workflow.company_id = activation.company_id
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(workflow.spec #> '{workflow,triggers}', '[]'::JSONB)
    ) trigger
    WHERE trigger ->> 'kind' = 'webhook'
      AND COALESCE(trigger ->> 'reconcile_every_minutes', '') ~ '^[0-9]{1,5}$'
      AND (trigger ->> 'reconcile_every_minutes')::INTEGER BETWEEN 5 AND 10080
    ORDER BY activation.activated_at, activation.workflow_id, trigger ->> 'id'
    LIMIT p_schedule_limit
  ), inserted AS (
    INSERT INTO public.agent_signal_dispatches(
      company_id, workflow_id, binding_snapshot_id, trigger_id, trigger_kind,
      signal_kind, execution_mode, trigger_snapshot, input, dedupe_key
    )
    SELECT
      due.company_id, due.workflow_id, due.binding_snapshot_id, due.trigger_id,
      'webhook', 'reconciliation', due.execution_mode, due.trigger_snapshot,
      jsonb_build_object(
        'scheduledFor', due.scheduled_for,
        'everyMinutes', due.every_minutes,
        'recordTypes', due.trigger_snapshot -> 'record_types',
        'sourceKinds', due.trigger_snapshot -> 'source_kinds'
      ),
      encode(extensions.digest(convert_to(
        due.company_id::TEXT || ':' || due.workflow_id::TEXT || ':'
        || due.trigger_id || ':reconciliation:' || due.scheduled_for::TEXT,
        'UTF8'
      ), 'sha256'), 'hex')
    FROM due
    ON CONFLICT (company_id, dedupe_key) DO NOTHING
    RETURNING id, company_id, trigger_id, signal_kind
  ), logged AS (
    INSERT INTO public.agent_signal_dispatch_events(
      company_id, dispatch_id, event_type, actor_type, reason, details
    )
    SELECT
      inserted.company_id, inserted.id, 'enqueued', 'heartbeat',
      'Periodic reconciliation became due for an active change trigger.',
      jsonb_build_object('triggerId', inserted.trigger_id, 'signalKind', inserted.signal_kind)
    FROM inserted
    RETURNING id
  )
  SELECT count(*)::INTEGER INTO reconciliation_dispatches_enqueued FROM logged;

  RETURN jsonb_build_object(
    'changeWindowsProcessed', change_windows_processed,
    'changeDispatchesEnqueued', change_dispatches_enqueued,
    'scheduleDispatchesEnqueued', schedule_dispatches_enqueued,
    'reconciliationDispatchesEnqueued', reconciliation_dispatches_enqueued,
    'preparedAt', p_now
  );
END;
$$;

CREATE FUNCTION workflow_private.claim_agent_signal_dispatches(
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
     AND runtime_state.lifecycle_state = 'active'
    WHERE dispatch.status IN ('pending','processing')
      AND dispatch.available_at <= p_now
      AND (dispatch.leased_until IS NULL OR dispatch.leased_until <= p_now)
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
      company_id, dispatch_id, event_type, actor_type, worker_id, reason, details
    )
    SELECT
      claimed.company_id, claimed.id, 'claimed', 'worker', trim(p_worker_id),
      'Signal dispatch claimed for compiled runtime execution.',
      jsonb_build_object(
        'leaseId', claimed.lease_id,
        'leasedUntil', claimed.leased_until,
        'attempt', claimed.attempts
      )
    FROM claimed
    RETURNING dispatch_id
  )
  SELECT
    claimed.lease_id,
    jsonb_build_object(
      'id', claimed.id,
      'companyId', claimed.company_id,
      'workflowId', claimed.workflow_id,
      'bindingSnapshotId', claimed.binding_snapshot_id,
      'changeWindowId', claimed.change_window_id,
      'triggerId', claimed.trigger_id,
      'triggerKind', claimed.trigger_kind,
      'signalKind', claimed.signal_kind,
      'executionMode', claimed.execution_mode,
      'trigger', claimed.trigger_snapshot,
      'input', claimed.input,
      'attempt', claimed.attempts,
      'maxAttempts', claimed.max_attempts,
      'createdAt', claimed.created_at
    )
  FROM claimed
  WHERE EXISTS (
    SELECT 1 FROM logged WHERE logged.dispatch_id = claimed.id
  );
END;
$$;

CREATE FUNCTION workflow_private.complete_agent_signal_dispatch(
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
DECLARE
  target public.agent_signal_dispatches%ROWTYPE;
  next_status TEXT;
BEGIN
  IF length(trim(COALESCE(p_worker_id, ''))) NOT BETWEEN 1 AND 128
    OR p_lease_id IS NULL
    OR p_outcome NOT IN ('completed','suppressed')
    OR jsonb_typeof(COALESCE(p_result, 'null'::JSONB)) <> 'object'
    OR pg_column_size(p_result) > 65536
  THEN
    RAISE EXCEPTION 'invalid_agent_signal_completion' USING ERRCODE = '22023';
  END IF;

  SELECT dispatch.* INTO target
  FROM public.agent_signal_dispatches dispatch
  WHERE dispatch.lease_id = p_lease_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_signal_dispatch_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF target.lease_owner IS DISTINCT FROM trim(p_worker_id)
    OR target.leased_until <= now()
  THEN
    RAISE EXCEPTION 'agent_signal_lease_lost' USING ERRCODE = '40001';
  END IF;

  next_status := p_outcome;
  UPDATE public.agent_signal_dispatches
  SET status = next_status,
      result = p_result,
      completed_at = now(),
      lease_id = NULL,
      lease_owner = NULL,
      leased_until = NULL
  WHERE id = target.id;

  INSERT INTO public.agent_signal_dispatch_events(
    company_id, dispatch_id, event_type, actor_type, worker_id, reason, details
  ) VALUES (
    target.company_id, target.id, next_status, 'worker', trim(p_worker_id),
    CASE next_status
      WHEN 'completed' THEN 'Compiled signal runtime completed.'
      ELSE 'Compiled signal runtime suppressed the candidate.'
    END,
    p_result
  );

  RETURN jsonb_build_object('dispatchId', target.id, 'status', next_status);
END;
$$;

CREATE FUNCTION workflow_private.fail_agent_signal_dispatch(
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
DECLARE
  target public.agent_signal_dispatches%ROWTYPE;
  dead_letter BOOLEAN;
  next_available_at TIMESTAMPTZ;
BEGIN
  IF length(trim(COALESCE(p_worker_id, ''))) NOT BETWEEN 1 AND 128
    OR p_lease_id IS NULL
    OR p_retryable IS NULL
    OR length(COALESCE(p_error_code, '')) NOT BETWEEN 1 AND 64
    OR p_error_code !~ '^[a-z0-9_]+$'
  THEN
    RAISE EXCEPTION 'invalid_agent_signal_failure' USING ERRCODE = '22023';
  END IF;

  SELECT dispatch.* INTO target
  FROM public.agent_signal_dispatches dispatch
  WHERE dispatch.lease_id = p_lease_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent_signal_dispatch_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF target.lease_owner IS DISTINCT FROM trim(p_worker_id)
    OR target.leased_until <= now()
  THEN
    RAISE EXCEPTION 'agent_signal_lease_lost' USING ERRCODE = '40001';
  END IF;

  dead_letter := NOT p_retryable OR target.attempts >= target.max_attempts;
  next_available_at := now() + make_interval(
    mins => LEAST(power(2, GREATEST(target.attempts, 1))::INTEGER, 60)
  );

  UPDATE public.agent_signal_dispatches
  SET status = CASE WHEN dead_letter THEN 'dead_letter' ELSE 'pending' END,
      available_at = next_available_at,
      result = jsonb_build_object(
        'errorCode', p_error_code,
        'retryable', p_retryable
      ),
      completed_at = CASE WHEN dead_letter THEN now() ELSE NULL END,
      lease_id = NULL,
      lease_owner = NULL,
      leased_until = NULL
  WHERE id = target.id;

  INSERT INTO public.agent_signal_dispatch_events(
    company_id, dispatch_id, event_type, actor_type, worker_id, reason, details
  ) VALUES (
    target.company_id, target.id,
    CASE WHEN dead_letter THEN 'dead_letter' ELSE 'retry_scheduled' END,
    'worker', trim(p_worker_id), p_error_code,
    jsonb_build_object(
      'retryable', p_retryable,
      'attempt', target.attempts,
      'availableAt', CASE WHEN dead_letter THEN NULL ELSE next_available_at END
    )
  );

  RETURN jsonb_build_object(
    'dispatchId', target.id,
    'status', CASE WHEN dead_letter THEN 'dead_letter' ELSE 'pending' END
  );
END;
$$;

REVOKE ALL ON FUNCTION workflow_private.capture_external_record_change_window()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.reject_agent_signal_dispatch_event_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.prepare_agent_signal_dispatches(TIMESTAMPTZ,INTEGER,INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.claim_agent_signal_dispatches(TEXT,INTEGER,INTEGER,TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.complete_agent_signal_dispatch(TEXT,UUID,TEXT,JSONB)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION workflow_private.fail_agent_signal_dispatch(TEXT,UUID,BOOLEAN,TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION workflow_private.prepare_agent_signal_dispatches(TIMESTAMPTZ,INTEGER,INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION workflow_private.claim_agent_signal_dispatches(TEXT,INTEGER,INTEGER,TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION workflow_private.complete_agent_signal_dispatch(TEXT,UUID,TEXT,JSONB)
  TO service_role;
GRANT EXECUTE ON FUNCTION workflow_private.fail_agent_signal_dispatch(TEXT,UUID,BOOLEAN,TEXT)
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
DECLARE
  existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'prepare-agent-signal-dispatches';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'prepare-agent-signal-dispatches',
    '* * * * *',
    $job$SELECT workflow_private.prepare_agent_signal_dispatches(now(), 500, 500)$job$
  );
END;
$$;

COMMENT ON TABLE public.agent_signal_change_windows IS
  'Coalesced normalized connector changes, grouped by transaction/source/record type for bounded signal fan-out.';
COMMENT ON TABLE public.agent_signal_dispatches IS
  'Idempotent scheduled, connector-change, and reconciliation work for active compiled agent triggers.';
COMMENT ON FUNCTION workflow_private.prepare_agent_signal_dispatches(TIMESTAMPTZ,INTEGER,INTEGER) IS
  'Matches coalesced connector changes and due intervals to active compiled triggers without scanning raw record payloads.';
