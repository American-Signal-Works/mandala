-- Reconcile provider-accepted documents in bounded batches. Supermemory's
-- filtered document listing returns workflow status for up to 100 exact
-- stable IDs per request, so one durable worker claim can safely settle more
-- than one document without spending one provider request per row.

ALTER TABLE public.context_index_events
  DROP CONSTRAINT context_index_events_event_type_check;
ALTER TABLE public.context_index_events
  ADD CONSTRAINT context_index_events_event_type_check CHECK (
    event_type IN (
      'enqueued', 'superseded', 'claimed', 'completed', 'retry_scheduled',
      'dead_lettered', 'reconciliation_required', 'lease_expired',
      'reconciliation_created', 'claim_blocked', 'deletion_confirmed',
      'provider_accepted', 'provider_poll_claimed', 'provider_poll_deferred',
      'provider_batch_claimed', 'provider_poll_batch_claimed'
    )
  );

CREATE OR REPLACE FUNCTION public.claim_context_index_processing_v1(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 60,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  controls RECORD;
  candidate public.context_index_outbox%ROWTYPE;
  lease_id_value UUID;
  lease_expires_value TIMESTAMPTZ;
  claims JSONB := '[]'::JSONB;
  claims_before_company INTEGER;
  recent_provider_requests INTEGER;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF length(COALESCE(p_worker_id, '')) NOT BETWEEN 1 AND 120
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_limit NOT BETWEEN 1 AND 600
    OR p_lease_seconds NOT BETWEEN 15 AND 900
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_index_processing_claim'
      USING ERRCODE = '22023';
  END IF;

  FOR controls IN
    SELECT control.*
    FROM public.context_index_operation_controls control
    JOIN public.context_workspace_settings setting
      ON setting.company_id = control.company_id
     AND setting.provider = control.provider
     AND setting.readiness = 'ready'
    WHERE control.provider = 'supermemory'
      AND control.worker_enabled
    ORDER BY control.company_id, control.provider
    FOR UPDATE OF control
  LOOP
    EXIT WHEN jsonb_array_length(claims) >= p_limit;

    SELECT count(*)::INTEGER INTO recent_provider_requests
    FROM public.context_index_events event
    WHERE event.company_id = controls.company_id
      AND event.provider = controls.provider
      AND event.created_at >= p_now - interval '1 minute'
      AND (
        event.event_type IN (
          'provider_batch_claimed', 'provider_poll_batch_claimed'
        )
        OR (
          event.event_type = 'claimed'
          AND event.safe_error_code = 'provider_health_reserved'
        )
      );
    IF recent_provider_requests >= controls.requests_per_minute THEN
      CONTINUE;
    END IF;

    claims_before_company := jsonb_array_length(claims);
    FOR candidate IN
      SELECT outbox.*
      FROM public.context_index_outbox outbox
      WHERE outbox.company_id = controls.company_id
        AND outbox.provider = controls.provider
        AND outbox.delivery_state = 'awaiting_provider'
        AND outbox.provider_result_document_id IS NOT NULL
        AND outbox.operation IN ('add', 'replace')
        AND outbox.available_at <= p_now
      ORDER BY outbox.provider_accepted_at, outbox.id
      LIMIT p_limit - jsonb_array_length(claims)
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
        candidate.company_id, candidate.provider, candidate.id,
        candidate.job_id, 'provider_poll_claimed', candidate.operation,
        candidate.attempt_count, 0, p_now
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

    IF jsonb_array_length(claims) > claims_before_company THEN
      INSERT INTO public.context_index_events(
        company_id, provider, event_type, safe_error_code,
        estimated_cost_microunits, created_at
      ) VALUES (
        controls.company_id, controls.provider,
        'claimed', 'provider_poll_batch_reserved', 0, p_now
      ), (
        controls.company_id, controls.provider,
        'provider_poll_batch_claimed', 'provider_poll_batch_reserved',
        0, p_now
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

-- Count one provider request for a poll batch rather than one request for each
-- durable document audit event in that batch.
CREATE OR REPLACE FUNCTION public.reserve_context_provider_health_v1(
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
          AND event.created_at >= p_now - interval '1 minute'
          AND (
            event.event_type IN (
              'provider_batch_claimed', 'provider_poll_batch_claimed'
            )
            OR (
              event.event_type = 'claimed'
              AND event.safe_error_code = 'provider_health_reserved'
            )
          )
      ) >= controls.requests_per_minute
  ) THEN
    RETURN jsonb_build_object(
      'reserved', false,
      'workspaceCount', workspace_count
    );
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

  RETURN jsonb_build_object(
    'reserved', true,
    'workspaceCount', workspace_count
  );
END;
$$;

-- Keep add-batch reservation on the same provider-request accounting surface.
DO $migration$
DECLARE
  definition TEXT;
  updated_definition TEXT;
  old_fragment TEXT := 'AND event.event_type = ''provider_batch_claimed''';
  new_fragment TEXT := 'AND (
        event.event_type IN (
          ''provider_batch_claimed'', ''provider_poll_batch_claimed''
        )
        OR (
          event.event_type = ''claimed''
          AND event.safe_error_code = ''provider_health_reserved''
        )
      )';
BEGIN
  SELECT pg_get_functiondef(
    'public.claim_context_index_add_batch_v1(text,integer,integer,timestamp with time zone)'::regprocedure
  ) INTO definition;
  IF position(old_fragment IN definition) = 0
    AND position(new_fragment IN definition) = 0
  THEN
    RAISE EXCEPTION 'context add batch rate fragment not found';
  END IF;
  IF position(old_fragment IN definition) > 0 THEN
    updated_definition := replace(definition, old_fragment, new_fragment);
    EXECUTE updated_definition;
  END IF;
END
$migration$;

COMMENT ON FUNCTION public.claim_context_index_processing_v1(TEXT, INTEGER, INTEGER, TIMESTAMPTZ) IS
  'Claims up to 600 provider-accepted documents and accounts each bounded Supermemory status batch as one request.';
