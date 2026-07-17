-- Keep the maintenance preflight proportional to the requested work instead
-- of validating the entire pending corpus before every provider dispatch.
CREATE INDEX context_index_outbox_expired_lease_idx
  ON public.context_index_outbox(lease_expires_at, id)
  WHERE delivery_state = 'leased';

DO $migration$
DECLARE
  definition TEXT;
  updated_definition TEXT;
  loop_fragment TEXT := 'FOR invalid IN
    SELECT';
  bounded_loop_fragment TEXT := 'FOR invalid IN
    WITH queue_slice AS MATERIALIZED (
      SELECT queued.id
      FROM public.context_index_outbox queued
      WHERE queued.delivery_state IN (''pending'', ''retry'')
        AND queued.operation IN (''add'', ''replace'')
        AND queued.available_at <= p_now
      ORDER BY queued.available_at, queued.id
      LIMIT LEAST(p_limit * 2, 2000)
      FOR UPDATE OF queued SKIP LOCKED
    )
    SELECT';
  source_fragment TEXT := '    FROM public.context_index_outbox outbox
    LEFT JOIN public.external_records record';
  bounded_source_fragment TEXT := '    FROM queue_slice
    JOIN public.context_index_outbox outbox ON outbox.id = queue_slice.id
    LEFT JOIN public.external_records record';
BEGIN
  SELECT pg_get_functiondef(
    'public.prepare_context_index_work_legacy_v1(timestamp with time zone,integer)'::regprocedure
  ) INTO definition;

  IF position(loop_fragment IN definition) = 0
    OR position(source_fragment IN definition) = 0
  THEN
    RAISE EXCEPTION 'context prepare validation fragments not found';
  END IF;

  updated_definition := replace(definition, loop_fragment, bounded_loop_fragment);
  updated_definition := replace(
    updated_definition,
    source_fragment,
    bounded_source_fragment
  );
  EXECUTE updated_definition;
END
$migration$;

-- A Supermemory batch is one provider request even though it preserves one
-- durable claim event per document. Count the batch marker once and exclude
-- its same-timestamp per-document audit events from the request-rate gate.
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
              'provider_batch_claimed',
              'provider_poll_claimed'
            )
            OR (
              event.event_type = 'claimed'
              AND (
                event.safe_error_code = 'provider_health_reserved'
                OR NOT EXISTS (
                  SELECT 1
                  FROM public.context_index_events batch_event
                  WHERE batch_event.company_id = event.company_id
                    AND batch_event.provider = event.provider
                    AND batch_event.event_type = 'provider_batch_claimed'
                    AND batch_event.created_at = event.created_at
                )
              )
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

COMMENT ON INDEX public.context_index_outbox_expired_lease_idx IS
  'Bounds expired provider lease recovery by expiry order.';

COMMENT ON FUNCTION public.reserve_context_provider_health_v1(TIMESTAMPTZ) IS
  'Reserves live Supermemory health probes while counting bulk ingestion as one provider request per batch.';
