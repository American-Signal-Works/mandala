-- Cycle 0.0.8: durable asynchronous provider completion.
-- Canonical content remains in external_records; this lifecycle stores only
-- provider identity, hashes, bounded status codes, and lease metadata.

ALTER TABLE public.context_index_outbox
  DROP CONSTRAINT context_index_outbox_delivery_state_check;
ALTER TABLE public.context_index_outbox
  ADD CONSTRAINT context_index_outbox_delivery_state_check CHECK (
    delivery_state IN (
      'pending', 'leased', 'retry', 'awaiting_provider', 'completed',
      'dead_letter', 'needs_reconciliation', 'superseded'
    )
  );
ALTER TABLE public.context_index_outbox
  DROP CONSTRAINT context_index_outbox_check1;
ALTER TABLE public.context_index_outbox
  ADD CONSTRAINT context_index_outbox_delivery_state_terminal_at_check CHECK (
    (
      delivery_state IN ('completed', 'dead_letter', 'needs_reconciliation', 'superseded')
      AND terminal_at IS NOT NULL
    ) OR (
      delivery_state NOT IN ('completed', 'dead_letter', 'needs_reconciliation', 'superseded')
      AND terminal_at IS NULL
    )
  );

ALTER TABLE public.context_index_ledger
  DROP CONSTRAINT context_index_ledger_status_check;
ALTER TABLE public.context_index_ledger
  ADD CONSTRAINT context_index_ledger_status_check CHECK (
    status IN (
      'pending', 'processing', 'indexed', 'delete_pending', 'deleted',
      'error', 'reconcile_required'
    )
  );

ALTER TABLE public.context_index_operation_controls
  ADD COLUMN provider_health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
    provider_health_status IN ('unknown', 'healthy', 'degraded', 'unavailable')
  ),
  ADD COLUMN provider_health_checked_at TIMESTAMPTZ,
  ADD COLUMN provider_health_detail_code TEXT CHECK (
    provider_health_detail_code IS NULL
    OR provider_health_detail_code ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  );

ALTER TABLE public.context_index_events
  DROP CONSTRAINT context_index_events_event_type_check;
ALTER TABLE public.context_index_events
  ADD CONSTRAINT context_index_events_event_type_check CHECK (
    event_type IN (
      'enqueued', 'superseded', 'claimed', 'completed', 'retry_scheduled',
      'dead_lettered', 'reconciliation_required', 'lease_expired',
      'reconciliation_created', 'claim_blocked', 'deletion_confirmed',
      'provider_accepted', 'provider_poll_claimed', 'provider_poll_deferred'
    )
  );

ALTER TABLE public.context_index_outbox
  ADD COLUMN provider_result_document_id TEXT CHECK (
    provider_result_document_id IS NULL
    OR length(provider_result_document_id) BETWEEN 1 AND 500
  ),
  ADD COLUMN provider_processing_status TEXT CHECK (
    provider_processing_status IS NULL
    OR provider_processing_status IN (
      'accepted', 'pending', 'processing', 'unavailable', 'complete', 'failed'
    )
  ),
  ADD COLUMN provider_accepted_at TIMESTAMPTZ,
  ADD COLUMN provider_checked_at TIMESTAMPTZ,
  ADD COLUMN poll_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (poll_attempt_count BETWEEN 0 AND 1000),
  ADD COLUMN dispatch_started_at TIMESTAMPTZ,
  ADD CONSTRAINT context_index_outbox_provider_result_shape CHECK (
    (provider_result_document_id IS NULL AND provider_accepted_at IS NULL)
    OR (
      operation IN ('add', 'replace')
      AND provider_result_document_id IS NOT NULL
      AND provider_accepted_at IS NOT NULL
    )
  );

CREATE INDEX context_index_outbox_provider_processing_idx
  ON public.context_index_outbox(delivery_state, available_at, provider_accepted_at, id)
  WHERE provider_result_document_id IS NOT NULL;

CREATE TABLE public.context_index_operation_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'supermemory'),
  previous_readiness TEXT NOT NULL CHECK (previous_readiness IN ('not_ready', 'ready', 'error')),
  readiness TEXT NOT NULL CHECK (readiness IN ('not_ready', 'ready', 'error')),
  previous_worker_enabled BOOLEAN NOT NULL,
  worker_enabled BOOLEAN NOT NULL,
  previous_canary_record_limit INTEGER NOT NULL,
  canary_record_limit INTEGER NOT NULL,
  previous_daily_operation_cap INTEGER NOT NULL,
  daily_operation_cap INTEGER NOT NULL,
  requests_per_minute INTEGER NOT NULL,
  daily_cost_cap_microunits BIGINT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  actor_kind TEXT NOT NULL DEFAULT 'service_role' CHECK (actor_kind = 'service_role'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.context_index_operation_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.context_index_operation_audits
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION workflow_private.guard_context_provider_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- A dispatch marker is committed before the worker receives the claim. If a
  -- process dies after calling the provider, lease recovery cannot replay it.
  IF OLD.delivery_state IN ('pending', 'retry')
    AND NEW.delivery_state = 'leased'
    AND NEW.operation IN ('add', 'replace')
    AND NEW.provider_result_document_id IS NULL
  THEN
    NEW.dispatch_started_at := COALESCE(NEW.dispatch_started_at, now());
  END IF;

  IF NEW.delivery_state = 'completed' THEN
    NEW.provider_processing_status := CASE
      WHEN NEW.provider_result_document_id IS NULL
      THEN NEW.provider_processing_status
      ELSE 'complete'
    END;
    NEW.provider_checked_at := CASE
      WHEN NEW.provider_result_document_id IS NULL
      THEN NEW.provider_checked_at
      ELSE now()
    END;
    NEW.dispatch_started_at := NULL;
  ELSIF NEW.delivery_state IN ('dead_letter', 'superseded') THEN
    NEW.dispatch_started_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_index_outbox_provider_lifecycle
BEFORE UPDATE ON public.context_index_outbox
FOR EACH ROW EXECUTE FUNCTION workflow_private.guard_context_provider_lifecycle();

-- Put provider-aware expiry handling in front of the original maintenance
-- function. The legacy function remains private and handles ordinary leases.
ALTER FUNCTION public.prepare_context_index_work_v1(TIMESTAMPTZ, INTEGER)
  RENAME TO prepare_context_index_work_legacy_v1;
REVOKE ALL ON FUNCTION public.prepare_context_index_work_legacy_v1(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.prepare_context_index_work_v1(
  p_now TIMESTAMPTZ DEFAULT now(),
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  expired public.context_index_outbox%ROWTYPE;
  base_result JSONB;
  recovered_count INTEGER := 0;
  dead_lettered_count INTEGER := 0;
  processed_count INTEGER := 0;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF p_now IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_context_index_prepare_request' USING ERRCODE = '22023';
  END IF;

  FOR expired IN
    SELECT outbox.*
    FROM public.context_index_outbox outbox
    WHERE outbox.delivery_state = 'leased'
      AND outbox.lease_expires_at <= p_now
      AND (
        outbox.provider_result_document_id IS NOT NULL
        OR outbox.dispatch_started_at IS NOT NULL
      )
    ORDER BY outbox.lease_expires_at, outbox.id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF expired.provider_result_document_id IS NOT NULL THEN
      UPDATE public.context_index_outbox
      SET delivery_state = 'awaiting_provider',
          available_at = p_now,
          lease_id = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          safe_error_code = NULL,
          reserved_cost_microunits = 0,
          terminal_at = NULL,
          updated_at = p_now
      WHERE id = expired.id;
      UPDATE public.context_index_ledger
      SET status = 'processing',
          safe_error_code = NULL,
          updated_at = p_now
      WHERE company_id = expired.company_id
        AND provider = expired.provider
        AND canonical_record_id = expired.canonical_record_id;
      INSERT INTO public.context_index_events(
        company_id, provider, outbox_id, job_id, event_type, operation,
        attempt_count, safe_error_code, created_at
      ) VALUES (
        expired.company_id, expired.provider, expired.id, expired.job_id,
        'provider_poll_deferred', expired.operation, expired.attempt_count,
        'lease_expired', p_now
      );
      recovered_count := recovered_count + 1;
    ELSE
      UPDATE public.context_index_outbox
      SET delivery_state = 'needs_reconciliation',
          lease_id = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          safe_error_code = 'dispatch_outcome_unknown',
          reserved_cost_microunits = 0,
          terminal_at = p_now,
          updated_at = p_now
      WHERE id = expired.id;
      UPDATE public.context_index_ledger
      SET status = 'reconcile_required',
          last_error_at = p_now,
          safe_error_code = 'dispatch_outcome_unknown',
          updated_at = p_now
      WHERE company_id = expired.company_id
        AND provider = expired.provider
        AND canonical_record_id = expired.canonical_record_id;
      INSERT INTO public.context_index_events(
        company_id, provider, outbox_id, job_id, event_type, operation,
        attempt_count, safe_error_code, created_at
      ) VALUES (
        expired.company_id, expired.provider, expired.id, expired.job_id,
        'reconciliation_required', expired.operation, expired.attempt_count,
        'dispatch_outcome_unknown', p_now
      );
      IF expired.job_id IS NOT NULL THEN
        UPDATE public.context_index_jobs
        SET failed_count = failed_count + 1
        WHERE id = expired.job_id;
        UPDATE public.context_index_jobs
        SET status = 'failed', completed_at = p_now
        WHERE id = expired.job_id
          AND status = 'running'
          AND completed_count + failed_count >= queued_count;
      END IF;
    END IF;
    processed_count := processed_count + 1;
  END LOOP;

  IF processed_count < p_limit THEN
    base_result := public.prepare_context_index_work_legacy_v1(
      p_now, p_limit - processed_count
    );
    recovered_count := recovered_count
      + COALESCE((base_result ->> 'recoveredCount')::INTEGER, 0);
    dead_lettered_count := COALESCE(
      (base_result ->> 'deadLetteredCount')::INTEGER, 0
    );
  END IF;
  RETURN jsonb_build_object(
    'recoveredCount', recovered_count,
    'deadLetteredCount', dead_lettered_count
  );
END;
$$;

CREATE FUNCTION workflow_private.block_context_dispatch_while_processing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.operation IN ('add', 'replace')
    AND NEW.delivery_state = 'pending'
    AND EXISTS (
      SELECT 1
      FROM public.context_index_outbox active
      WHERE active.company_id = NEW.company_id
        AND active.provider = NEW.provider
        AND active.canonical_record_id = NEW.canonical_record_id
        AND active.provider_result_document_id IS NOT NULL
        AND active.delivery_state IN ('awaiting_provider', 'leased')
    )
  THEN
    NEW.delivery_state := 'needs_reconciliation';
    NEW.safe_error_code := 'blocked_by_provider_processing';
    NEW.terminal_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_index_outbox_block_parallel_dispatch
BEFORE INSERT ON public.context_index_outbox
FOR EACH ROW EXECUTE FUNCTION workflow_private.block_context_dispatch_while_processing();

CREATE FUNCTION workflow_private.release_context_dispatch_after_processing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.delivery_state = 'leased'
    AND NEW.delivery_state = 'completed'
    AND OLD.provider_result_document_id IS NOT NULL
  THEN
    UPDATE public.context_index_outbox queued
    SET delivery_state = 'pending',
        safe_error_code = NULL,
        terminal_at = NULL,
        available_at = now(),
        updated_at = now()
    WHERE queued.company_id = NEW.company_id
      AND queued.provider = NEW.provider
      AND queued.canonical_record_id = NEW.canonical_record_id
      AND queued.delivery_state = 'needs_reconciliation'
      AND queued.safe_error_code = 'blocked_by_provider_processing';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER context_index_outbox_release_parallel_dispatch
AFTER UPDATE ON public.context_index_outbox
FOR EACH ROW EXECUTE FUNCTION workflow_private.release_context_dispatch_after_processing();

CREATE FUNCTION workflow_private.require_context_provider_drain_before_off()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Share the same serialization lock used by provider claim paths. If a
  -- claim commits first, this trigger observes its durable dispatch marker;
  -- if Off commits first, the waiting claim rechecks settings and finds no
  -- ready provider.
  PERFORM 1
  FROM public.context_index_operation_controls controls
  WHERE controls.company_id = OLD.company_id
    AND controls.provider = 'supermemory'
  FOR UPDATE;

  IF OLD.provider = 'supermemory'
    AND NEW.provider = 'off'
    AND (
      EXISTS (
        SELECT 1
        FROM public.context_index_ledger ledger
        WHERE ledger.company_id = OLD.company_id
          AND ledger.provider = 'supermemory'
          AND ledger.provider_document_id IS NOT NULL
          AND ledger.status <> 'deleted'
      )
      OR EXISTS (
        SELECT 1
        FROM public.context_index_tombstones tombstone
        WHERE tombstone.company_id = OLD.company_id
          AND tombstone.provider = 'supermemory'
          AND tombstone.confirmed_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM public.context_index_outbox outbox
        WHERE outbox.company_id = OLD.company_id
          AND outbox.provider = 'supermemory'
          AND outbox.delivery_state IN (
            'leased', 'awaiting_provider', 'needs_reconciliation'
          )
          AND (
            outbox.dispatch_started_at IS NOT NULL
            OR outbox.provider_result_document_id IS NOT NULL
          )
      )
    )
  THEN
    RAISE EXCEPTION 'context_index_drain_required' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_workspace_settings_require_provider_drain
BEFORE UPDATE ON public.context_workspace_settings
FOR EACH ROW EXECUTE FUNCTION workflow_private.require_context_provider_drain_before_off();

CREATE FUNCTION public.claim_context_index_cleanup_v1(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 10,
  p_lease_seconds INTEGER DEFAULT 60,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate RECORD;
  lease_id_value UUID;
  lease_expires_value TIMESTAMPTZ;
  claims JSONB := '[]'::JSONB;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF length(COALESCE(p_worker_id, '')) NOT BETWEEN 1 AND 120
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds NOT BETWEEN 15 AND 900
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_index_cleanup_claim' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.context_index_operation_controls controls
  WHERE controls.provider = 'supermemory'
    AND controls.worker_enabled
  ORDER BY controls.company_id
  FOR UPDATE;

  FOR candidate IN
    SELECT
      outbox.*,
      policy.id AS policy_id,
      policy.approved_field_paths,
      policy.maximum_content_bytes,
      policy.classification,
      policy.retention_days,
      policy.projection_version,
      controls.max_attempts,
      controls.requests_per_minute,
      controls.estimated_operation_cost_microunits
    FROM public.context_index_outbox outbox
    JOIN public.context_workspace_settings setting
      ON setting.company_id = outbox.company_id
     AND setting.provider = outbox.provider
     AND setting.readiness = 'ready'
    JOIN public.context_index_operation_controls controls
      ON controls.company_id = outbox.company_id
     AND controls.provider = outbox.provider
     AND controls.worker_enabled
    JOIN public.context_indexing_policy_versions policy
      ON policy.company_id = outbox.company_id
     AND policy.source_key = outbox.source_key
     AND policy.record_type = outbox.record_type
     AND policy.policy_version = outbox.policy_version
     AND workflow_private.context_policy_hash(policy) = outbox.policy_hash
    WHERE outbox.delivery_state IN ('pending', 'retry')
      AND outbox.operation = 'delete'
      AND outbox.provider_document_id IS NOT NULL
      AND outbox.available_at <= p_now
      AND outbox.attempt_count < controls.max_attempts
      AND EXISTS (
        SELECT 1
        FROM public.context_index_tombstones tombstone
        WHERE tombstone.company_id = outbox.company_id
          AND tombstone.provider = outbox.provider
          AND tombstone.canonical_record_id = outbox.canonical_record_id
          AND tombstone.delete_outbox_id = outbox.id
          AND tombstone.confirmed_at IS NULL
      )
    ORDER BY outbox.available_at, outbox.created_at, outbox.id
    LIMIT p_limit
    FOR UPDATE OF outbox SKIP LOCKED
  LOOP
    -- Emergency deletion bypasses ingestion spend and daily-operation caps,
    -- but never the provider's hard traffic ceiling.
    IF (
      SELECT count(*)
      FROM public.context_index_events event
      WHERE event.company_id = candidate.company_id
        AND event.provider = candidate.provider
        AND event.event_type = 'claimed'
        AND event.created_at >= p_now - interval '1 minute'
    ) >= candidate.requests_per_minute THEN
      CONTINUE;
    END IF;
    lease_id_value := gen_random_uuid();
    lease_expires_value := p_now + make_interval(secs => p_lease_seconds);
    UPDATE public.context_index_outbox
    SET delivery_state = 'leased',
        attempt_count = attempt_count + 1,
        lease_id = lease_id_value,
        lease_owner = p_worker_id,
        lease_expires_at = lease_expires_value,
        safe_error_code = NULL,
        reserved_cost_microunits = candidate.estimated_operation_cost_microunits,
        updated_at = p_now
    WHERE id = candidate.id;
    UPDATE public.context_index_ledger
    SET attempt_count = attempt_count + 1,
        updated_at = p_now
    WHERE company_id = candidate.company_id
      AND provider = candidate.provider
      AND canonical_record_id = candidate.canonical_record_id;
    INSERT INTO public.context_index_events(
      company_id, provider, outbox_id, job_id, event_type, operation,
      attempt_count, estimated_cost_microunits, created_at
    ) VALUES (
      candidate.company_id, candidate.provider, candidate.id, candidate.job_id,
      'claimed', 'delete', candidate.attempt_count + 1,
      candidate.estimated_operation_cost_microunits, p_now
    );
    claims := claims || jsonb_build_array(jsonb_build_object(
      'outboxId', candidate.id,
      'leaseId', lease_id_value,
      'leaseExpiresAt', lease_expires_value,
      'companyId', candidate.company_id,
      'provider', candidate.provider,
      'operation', 'delete',
      'canonicalRecordId', candidate.canonical_record_id,
      'canonicalVersion', candidate.canonical_version,
      'policyVersion', candidate.policy_version,
      'policyId', candidate.policy_id,
      'policyHash', candidate.policy_hash,
      'contentHash', candidate.content_hash,
      'stableCustomId', candidate.stable_custom_id,
      'providerDocumentId', candidate.provider_document_id,
      'sourceKey', candidate.source_key,
      'recordType', candidate.record_type,
      'sourceId', NULL,
      'externalId', NULL,
      'observedAt', NULL,
      'attempt', candidate.attempt_count + 1,
      'maxAttempts', candidate.max_attempts,
      'approvedFieldPaths', candidate.approved_field_paths,
      'maximumContentBytes', candidate.maximum_content_bytes,
      'classification', candidate.classification,
      'retentionDays', candidate.retention_days,
      'projectionVersion', candidate.projection_version,
      'projectedContent', NULL,
      'canonicalPayload', NULL
    ));
  END LOOP;
  RETURN jsonb_build_object('claims', claims);
END;
$$;

CREATE FUNCTION public.accept_context_index_work_v1(
  p_worker_id TEXT,
  p_lease_id UUID,
  p_provider_document_id TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  leased public.context_index_outbox%ROWTYPE;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF length(COALESCE(p_worker_id, '')) NOT BETWEEN 1 AND 120
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_lease_id IS NULL
    OR length(COALESCE(p_provider_document_id, '')) NOT BETWEEN 1 AND 500
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_index_acceptance' USING ERRCODE = '22023';
  END IF;

  SELECT candidate.* INTO leased
  FROM public.context_index_outbox candidate
  WHERE candidate.lease_id = p_lease_id
    AND candidate.lease_owner = p_worker_id
    AND candidate.delivery_state = 'leased'
    AND candidate.lease_expires_at > p_now
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_index_lease_not_owned_or_expired' USING ERRCODE = '40001';
  END IF;
  IF leased.operation NOT IN ('add', 'replace')
    OR (leased.operation = 'replace' AND leased.provider_document_id <> p_provider_document_id)
  THEN
    RAISE EXCEPTION 'invalid_context_index_acceptance' USING ERRCODE = '22023';
  END IF;

  UPDATE public.context_index_outbox
  SET delivery_state = 'awaiting_provider',
      provider_result_document_id = p_provider_document_id,
      provider_processing_status = 'accepted',
      provider_accepted_at = p_now,
      provider_checked_at = p_now,
      available_at = p_now,
      lease_id = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      safe_error_code = NULL,
      reserved_cost_microunits = 0,
      terminal_at = NULL,
      updated_at = p_now
  WHERE id = leased.id;

  UPDATE public.context_index_ledger
  SET provider_document_id = p_provider_document_id,
      status = 'processing',
      safe_error_code = NULL,
      last_verified_at = p_now,
      updated_at = p_now
  WHERE company_id = leased.company_id
    AND provider = leased.provider
    AND canonical_record_id = leased.canonical_record_id;

  INSERT INTO public.context_index_events(
    company_id, provider, outbox_id, job_id, event_type, operation,
    attempt_count, cost_adjustment_microunits, created_at
  ) VALUES (
    leased.company_id, leased.provider, leased.id, leased.job_id,
    'provider_accepted', leased.operation, leased.attempt_count,
    -leased.reserved_cost_microunits, p_now
  );

  RETURN jsonb_build_object('outboxId', leased.id, 'status', 'awaiting_provider');
END;
$$;

CREATE FUNCTION public.claim_context_index_processing_v1(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 10,
  p_lease_seconds INTEGER DEFAULT 60,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate public.context_index_outbox%ROWTYPE;
  lease_id_value UUID;
  lease_expires_value TIMESTAMPTZ;
  claims JSONB := '[]'::JSONB;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF length(COALESCE(p_worker_id, '')) NOT BETWEEN 1 AND 120
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds NOT BETWEEN 15 AND 900
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_index_processing_claim' USING ERRCODE = '22023';
  END IF;

  -- Serialize allowance calculation with every other poll claimant. Without
  -- this lock, simultaneous cron/manual runs could each observe the same
  -- committed event count and both spend the remaining RPM allowance.
  PERFORM 1
  FROM public.context_index_operation_controls controls
  WHERE controls.provider = 'supermemory'
    AND controls.worker_enabled
  ORDER BY controls.company_id
  FOR UPDATE;

  FOR candidate IN
    WITH ranked AS (
      SELECT
        outbox.id,
        row_number() OVER (
          PARTITION BY outbox.company_id, outbox.provider
          ORDER BY outbox.provider_accepted_at, outbox.id
        ) AS company_ordinal,
        GREATEST(
          controls.requests_per_minute - (
          SELECT count(*)::INTEGER
          FROM public.context_index_events event
          WHERE event.company_id = outbox.company_id
            AND event.provider = outbox.provider
              AND event.event_type = 'claimed'
              AND event.created_at >= p_now - interval '1 minute'
          ),
          0
        ) AS company_allowance
      FROM public.context_index_outbox outbox
      JOIN public.context_workspace_settings setting
        ON setting.company_id = outbox.company_id
       AND setting.provider = outbox.provider
       AND setting.readiness = 'ready'
      JOIN public.context_index_operation_controls controls
        ON controls.company_id = outbox.company_id
       AND controls.provider = outbox.provider
       AND controls.worker_enabled
      WHERE outbox.delivery_state = 'awaiting_provider'
        AND outbox.provider_result_document_id IS NOT NULL
        AND outbox.operation IN ('add', 'replace')
        AND outbox.available_at <= p_now
    )
    SELECT outbox.*
    FROM ranked
    JOIN public.context_index_outbox outbox ON outbox.id = ranked.id
    WHERE ranked.company_ordinal <= ranked.company_allowance
    ORDER BY outbox.provider_accepted_at, outbox.id
    LIMIT p_limit
    FOR UPDATE OF outbox SKIP LOCKED
  LOOP
    lease_id_value := gen_random_uuid();
    lease_expires_value := p_now + make_interval(secs => p_lease_seconds);
    UPDATE public.context_index_outbox
    SET delivery_state = 'leased',
        lease_id = lease_id_value,
        lease_owner = p_worker_id,
        lease_expires_at = lease_expires_value,
        poll_attempt_count = poll_attempt_count + 1,
        terminal_at = NULL,
        updated_at = p_now
    WHERE id = candidate.id;

    INSERT INTO public.context_index_events(
      company_id, provider, outbox_id, job_id, event_type, operation,
      attempt_count, estimated_cost_microunits, created_at
    ) VALUES (
      candidate.company_id, candidate.provider, candidate.id, candidate.job_id,
      'claimed', candidate.operation, candidate.attempt_count, 0, p_now
    );
    INSERT INTO public.context_index_events(
      company_id, provider, outbox_id, job_id, event_type, operation,
      attempt_count, estimated_cost_microunits, created_at
    ) VALUES (
      candidate.company_id, candidate.provider, candidate.id, candidate.job_id,
      'provider_poll_claimed', candidate.operation, candidate.attempt_count, 0, p_now
    );

    claims := claims || jsonb_build_array(jsonb_build_object(
      'outboxId', candidate.id,
      'leaseId', lease_id_value,
      'leaseExpiresAt', lease_expires_value,
      'companyId', candidate.company_id,
      'provider', candidate.provider,
      'operation', candidate.operation,
      'stableCustomId', candidate.stable_custom_id,
      'providerDocumentId', candidate.provider_result_document_id,
      'contentHash', candidate.content_hash,
      'pollAttempt', candidate.poll_attempt_count + 1,
      'maximumPollAttempts', 120
    ));
  END LOOP;
  RETURN jsonb_build_object('claims', claims);
END;
$$;

CREATE FUNCTION public.defer_context_index_processing_v1(
  p_worker_id TEXT,
  p_lease_id UUID,
  p_processing_status TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  leased public.context_index_outbox%ROWTYPE;
  next_state TEXT;
  next_available TIMESTAMPTZ;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF length(COALESCE(p_worker_id, '')) NOT BETWEEN 1 AND 120
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_lease_id IS NULL
    OR p_processing_status NOT IN ('pending', 'processing', 'unavailable')
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_index_processing_defer' USING ERRCODE = '22023';
  END IF;
  SELECT candidate.* INTO leased
  FROM public.context_index_outbox candidate
  WHERE candidate.lease_id = p_lease_id
    AND candidate.lease_owner = p_worker_id
    AND candidate.delivery_state = 'leased'
    AND candidate.provider_result_document_id IS NOT NULL
    AND candidate.lease_expires_at > p_now
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_index_lease_not_owned_or_expired' USING ERRCODE = '40001';
  END IF;

  next_state := CASE
    WHEN leased.poll_attempt_count >= 120 THEN 'needs_reconciliation'
    ELSE 'awaiting_provider'
  END;
  next_available := p_now + CASE
    WHEN p_processing_status = 'unavailable' THEN interval '60 seconds'
    ELSE interval '15 seconds'
  END;
  UPDATE public.context_index_outbox
  SET delivery_state = next_state,
      provider_processing_status = p_processing_status,
      provider_checked_at = p_now,
      available_at = next_available,
      lease_id = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      safe_error_code = CASE
        WHEN next_state = 'needs_reconciliation' THEN 'provider_processing_timeout'
        ELSE NULL
      END,
      terminal_at = CASE WHEN next_state = 'needs_reconciliation' THEN p_now ELSE NULL END,
      updated_at = p_now
  WHERE id = leased.id;

  UPDATE public.context_index_ledger
  SET status = CASE WHEN next_state = 'needs_reconciliation' THEN 'reconcile_required' ELSE 'processing' END,
      safe_error_code = CASE WHEN next_state = 'needs_reconciliation' THEN 'provider_processing_timeout' ELSE NULL END,
      last_verified_at = p_now,
      updated_at = p_now
  WHERE company_id = leased.company_id
    AND provider = leased.provider
    AND canonical_record_id = leased.canonical_record_id;

  INSERT INTO public.context_index_events(
    company_id, provider, outbox_id, job_id, event_type, operation,
    attempt_count, safe_error_code, created_at
  ) VALUES (
    leased.company_id, leased.provider, leased.id, leased.job_id,
    CASE WHEN next_state = 'needs_reconciliation' THEN 'reconciliation_required' ELSE 'provider_poll_deferred' END,
    leased.operation, leased.attempt_count,
    CASE WHEN next_state = 'needs_reconciliation' THEN 'provider_processing_timeout' ELSE NULL END,
    p_now
  );
  IF next_state = 'needs_reconciliation' AND leased.job_id IS NOT NULL THEN
    UPDATE public.context_index_jobs
    SET failed_count = failed_count + 1
    WHERE id = leased.job_id;
    UPDATE public.context_index_jobs
    SET status = 'failed', completed_at = p_now
    WHERE id = leased.job_id
      AND status = 'running'
      AND completed_count + failed_count >= queued_count;
  END IF;
  RETURN jsonb_build_object('outboxId', leased.id, 'status', next_state);
END;
$$;

-- Reserve rate capacity before the external health request. Failed probes
-- still consume their reserved request, which mirrors real provider traffic.
CREATE FUNCTION public.reserve_context_provider_health_v1(
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace_count INTEGER;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'invalid_context_provider_health_reservation'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.context_index_operation_controls controls
  JOIN public.context_workspace_settings setting
    ON setting.company_id = controls.company_id
   AND setting.provider = controls.provider
  WHERE controls.provider = 'supermemory'
  ORDER BY controls.company_id
  FOR UPDATE OF controls;

  SELECT count(*)::INTEGER INTO workspace_count
  FROM public.context_index_operation_controls controls
  JOIN public.context_workspace_settings setting
    ON setting.company_id = controls.company_id
   AND setting.provider = controls.provider
  WHERE controls.provider = 'supermemory';
  IF workspace_count = 0 OR EXISTS (
    SELECT 1
    FROM public.context_index_operation_controls controls
    JOIN public.context_workspace_settings setting
      ON setting.company_id = controls.company_id
     AND setting.provider = controls.provider
    WHERE controls.provider = 'supermemory'
      AND (
        SELECT count(*)
        FROM public.context_index_events event
        WHERE event.company_id = controls.company_id
          AND event.provider = controls.provider
          AND event.event_type = 'claimed'
          AND event.created_at >= p_now - interval '1 minute'
      ) >= controls.requests_per_minute
  ) THEN
    RETURN jsonb_build_object('reserved', false, 'workspaceCount', workspace_count);
  END IF;

  INSERT INTO public.context_index_events(
    company_id, provider, event_type, safe_error_code,
    estimated_cost_microunits, created_at
  )
  SELECT controls.company_id, controls.provider, 'claimed',
    'provider_health_reserved', 0, p_now
  FROM public.context_index_operation_controls controls
  JOIN public.context_workspace_settings setting
    ON setting.company_id = controls.company_id
   AND setting.provider = controls.provider
  WHERE controls.provider = 'supermemory';
  RETURN jsonb_build_object('reserved', true, 'workspaceCount', workspace_count);
END;
$$;

-- Provider readiness is backed by a live, bounded API probe. The credential
-- is shared by the provider adapter, so one successful probe updates every
-- Supermemory workspace without storing or exposing credential material.
CREATE FUNCTION public.record_context_provider_health_v1(
  p_status TEXT,
  p_detail_code TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected_count INTEGER;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF p_status NOT IN ('healthy', 'degraded', 'unavailable')
    OR (
      p_detail_code IS NOT NULL
      AND p_detail_code !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    )
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_provider_health' USING ERRCODE = '22023';
  END IF;

  UPDATE public.context_index_operation_controls
  SET provider_health_status = p_status,
      provider_health_checked_at = p_now,
      provider_health_detail_code = p_detail_code,
      updated_at = GREATEST(updated_at, p_now)
  WHERE provider = 'supermemory';
  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RETURN jsonb_build_object(
    'provider', 'supermemory',
    'status', p_status,
    'checkedAt', p_now,
    'workspaceCount', affected_count
  );
END;
$$;

ALTER FUNCTION public.get_context_index_status_v1(UUID)
  RENAME TO get_context_index_status_legacy_v1;
REVOKE ALL ON FUNCTION public.get_context_index_status_legacy_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_context_index_status_v1(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  controls public.context_index_operation_controls%ROWTYPE;
  base_result JSONB;
BEGIN
  PERFORM workflow_private.require_company_role(
    p_company_id, 'viewer', (SELECT auth.uid())
  );
  SELECT target.* INTO controls
  FROM public.context_index_operation_controls target
  WHERE target.company_id = p_company_id
    AND target.provider = 'supermemory';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_index_workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  base_result := public.get_context_index_status_legacy_v1(p_company_id);
  RETURN base_result || jsonb_build_object(
    'providerHealthStatus', controls.provider_health_status,
    'providerHealthCheckedAt', controls.provider_health_checked_at,
    'providerHealthDetailCode', controls.provider_health_detail_code,
    'providerHealthFresh',
      controls.provider_health_status = 'healthy'
      AND controls.provider_health_checked_at >= now() - interval '5 minutes'
  );
END;
$$;

CREATE FUNCTION public.configure_context_index_operations_v1(
  p_company_id UUID,
  p_readiness TEXT,
  p_worker_enabled BOOLEAN,
  p_canary_record_limit INTEGER,
  p_requests_per_minute INTEGER,
  p_daily_operation_cap INTEGER,
  p_daily_cost_cap_microunits BIGINT,
  p_reason TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  setting public.context_workspace_settings%ROWTYPE;
  controls public.context_index_operation_controls%ROWTYPE;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF p_company_id IS NULL
    OR p_readiness NOT IN ('not_ready', 'ready', 'error')
    OR p_worker_enabled IS NULL
    OR p_canary_record_limit NOT BETWEEN 0 AND 10000
    OR p_requests_per_minute NOT BETWEEN 1 AND 1000
    OR p_daily_operation_cap NOT BETWEEN 1 AND 100000
    OR p_daily_cost_cap_microunits NOT BETWEEN 0 AND 1000000000000
    OR length(trim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 1000
    OR p_now IS NULL
    OR (p_worker_enabled AND p_readiness <> 'ready')
    OR (p_worker_enabled AND (p_canary_record_limit = 0 OR p_daily_cost_cap_microunits = 0))
  THEN
    RAISE EXCEPTION 'invalid_context_index_operations' USING ERRCODE = '22023';
  END IF;
  SELECT target.* INTO setting
  FROM public.context_workspace_settings target
  WHERE target.company_id = p_company_id
  FOR UPDATE;
  IF NOT FOUND OR setting.provider <> 'supermemory' THEN
    RAISE EXCEPTION 'context_index_workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT target.* INTO controls
  FROM public.context_index_operation_controls target
  WHERE target.company_id = p_company_id AND target.provider = 'supermemory'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_index_workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_worker_enabled AND (
    controls.provider_health_status <> 'healthy'
    OR controls.provider_health_checked_at IS NULL
    OR controls.provider_health_checked_at < p_now - interval '5 minutes'
  ) THEN
    RAISE EXCEPTION 'context_provider_health_required' USING ERRCODE = '55000';
  END IF;

  UPDATE public.context_workspace_settings
  SET readiness = p_readiness,
      configuration_version = configuration_version + 1,
      updated_at = p_now
  WHERE company_id = p_company_id;
  UPDATE public.context_index_operation_controls
  SET worker_enabled = p_worker_enabled,
      canary_record_limit = p_canary_record_limit,
      requests_per_minute = p_requests_per_minute,
      daily_operation_cap = p_daily_operation_cap,
      daily_cost_cap_microunits = p_daily_cost_cap_microunits,
      updated_at = p_now
  WHERE company_id = p_company_id AND provider = 'supermemory';

  INSERT INTO public.context_index_operation_audits(
    company_id, provider, previous_readiness, readiness,
    previous_worker_enabled, worker_enabled,
    previous_canary_record_limit, canary_record_limit,
    previous_daily_operation_cap, daily_operation_cap,
    requests_per_minute, daily_cost_cap_microunits, reason, created_at
  ) VALUES (
    p_company_id, 'supermemory', setting.readiness, p_readiness,
    controls.worker_enabled, p_worker_enabled,
    controls.canary_record_limit, p_canary_record_limit,
    controls.daily_operation_cap, p_daily_operation_cap,
    p_requests_per_minute, p_daily_cost_cap_microunits, trim(p_reason), p_now
  );
  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'readiness', p_readiness,
    'workerEnabled', p_worker_enabled,
    'canaryRecordLimit', p_canary_record_limit,
    'dailyOperationCap', p_daily_operation_cap
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_context_index_work_v1(TEXT, UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_context_index_work_v1(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_context_index_processing_v1(TEXT, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_context_index_cleanup_v1(TEXT, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.defer_context_index_processing_v1(TEXT, UUID, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_context_index_operations_v1(UUID, TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER, BIGINT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_context_provider_health_v1(TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_context_provider_health_v1(TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_context_index_status_v1(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_context_index_work_v1(TEXT, UUID, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_context_index_work_v1(TIMESTAMPTZ, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_context_index_processing_v1(TEXT, INTEGER, INTEGER, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_context_index_cleanup_v1(TEXT, INTEGER, INTEGER, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.defer_context_index_processing_v1(TEXT, UUID, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.configure_context_index_operations_v1(UUID, TEXT, BOOLEAN, INTEGER, INTEGER, INTEGER, BIGINT, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_context_provider_health_v1(TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_context_provider_health_v1(TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_context_index_status_v1(UUID)
  TO authenticated;

REVOKE ALL ON FUNCTION workflow_private.guard_context_provider_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow_private.block_context_dispatch_while_processing() FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow_private.release_context_dispatch_after_processing() FROM PUBLIC;
REVOKE ALL ON FUNCTION workflow_private.require_context_provider_drain_before_off() FROM PUBLIC;
