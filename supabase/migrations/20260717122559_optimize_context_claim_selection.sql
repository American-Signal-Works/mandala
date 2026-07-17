-- Supermemory's bulk-ingestion contract accepts 1-600 documents per request.
-- Keep one durable lease and audit trail per document, but reserve/provider-call
-- capacity once for the batch. Candidate projection is intentionally bounded
-- before the expensive allowlist/hash checks so a large queue cannot make one
-- cron invocation scan the full corpus.

ALTER TABLE public.context_index_events
  DROP CONSTRAINT context_index_events_event_type_check;
ALTER TABLE public.context_index_events
  ADD CONSTRAINT context_index_events_event_type_check CHECK (
    event_type IN (
      'enqueued', 'superseded', 'claimed', 'completed', 'retry_scheduled',
      'dead_lettered', 'reconciliation_required', 'lease_expired',
      'reconciliation_created', 'claim_blocked', 'deletion_confirmed',
      'provider_accepted', 'provider_poll_claimed', 'provider_poll_deferred',
      'provider_batch_claimed'
    )
  );

CREATE FUNCTION public.claim_context_index_add_batch_v1(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 120,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  controls RECORD;
  candidate RECORD;
  lease_id_value UUID;
  lease_expires_value TIMESTAMPTZ;
  claims JSONB := '[]'::JSONB;
  claims_before_company INTEGER;
  company_allowance INTEGER;
  daily_claims INTEGER;
  daily_cost BIGINT;
  canary_claims INTEGER;
  recent_batch_requests INTEGER;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF length(COALESCE(p_worker_id, '')) NOT BETWEEN 1 AND 120
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_limit NOT BETWEEN 1 AND 600
    OR p_lease_seconds NOT BETWEEN 15 AND 900
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_index_batch_claim_request'
      USING ERRCODE = '22023';
  END IF;

  -- The row lock serializes every batch reservation for a tenant/provider, so
  -- concurrent cron/manual runs cannot spend the same gate allowance twice.
  FOR controls IN
    SELECT control.*
    FROM public.context_index_operation_controls control
    JOIN public.context_workspace_settings setting
      ON setting.company_id = control.company_id
     AND setting.provider = control.provider
     AND setting.readiness = 'ready'
    WHERE control.provider = 'supermemory'
      AND control.worker_enabled
      AND control.canary_record_limit > 0
      AND control.daily_cost_cap_microunits > 0
    ORDER BY control.company_id, control.provider
    FOR UPDATE OF control
  LOOP
    EXIT WHEN jsonb_array_length(claims) >= p_limit;

    SELECT count(*)::INTEGER INTO recent_batch_requests
    FROM public.context_index_events event
    WHERE event.company_id = controls.company_id
      AND event.provider = controls.provider
      AND event.event_type = 'provider_batch_claimed'
      AND event.created_at > p_now - INTERVAL '1 minute';
    IF recent_batch_requests >= controls.requests_per_minute THEN
      CONTINUE;
    END IF;

    SELECT count(*)::INTEGER INTO daily_claims
    FROM public.context_index_events event
    WHERE event.company_id = controls.company_id
      AND event.provider = controls.provider
      AND event.event_type = 'claimed'
      AND event.estimated_cost_microunits > 0
      AND event.created_at >= date_trunc('day', p_now);

    SELECT COALESCE(sum(
      event.estimated_cost_microunits + event.cost_adjustment_microunits
    ), 0)::BIGINT INTO daily_cost
    FROM public.context_index_events event
    WHERE event.company_id = controls.company_id
      AND event.provider = controls.provider
      AND event.created_at >= date_trunc('day', p_now);

    SELECT count(*)::INTEGER INTO canary_claims
    FROM public.context_index_ledger ledger
    WHERE ledger.company_id = controls.company_id
      AND ledger.provider = controls.provider
      AND ledger.attempt_count > 0;

    company_allowance := LEAST(
      p_limit - jsonb_array_length(claims),
      controls.daily_operation_cap - daily_claims,
      floor(
        (controls.daily_cost_cap_microunits - daily_cost)::NUMERIC
        / controls.estimated_operation_cost_microunits::NUMERIC
      )::INTEGER
    );
    IF company_allowance <= 0 THEN
      CONTINUE;
    END IF;

    claims_before_company := jsonb_array_length(claims);
    FOR candidate IN
      WITH base AS MATERIALIZED (
        SELECT outbox.id
        FROM public.context_index_outbox outbox
        JOIN public.context_index_ledger ledger
          ON ledger.company_id = outbox.company_id
         AND ledger.provider = outbox.provider
         AND ledger.canonical_record_id = outbox.canonical_record_id
        JOIN public.context_indexing_policy_versions policy
          ON policy.company_id = outbox.company_id
         AND policy.source_key = outbox.source_key
         AND policy.record_type = outbox.record_type
         AND policy.policy_version = outbox.policy_version
        JOIN public.external_records record
          ON record.id = outbox.canonical_record_id
         AND record.company_id = outbox.company_id
        WHERE outbox.company_id = controls.company_id
          AND outbox.provider = controls.provider
          AND outbox.delivery_state IN ('pending', 'retry')
          AND outbox.operation = 'add'
          AND outbox.available_at <= p_now
          AND outbox.attempt_count < controls.max_attempts
          AND policy.indexing_enabled
          AND workflow_private.context_policy_hash(policy) = outbox.policy_hash
          AND NOT EXISTS (
            SELECT 1
            FROM public.context_indexing_policy_versions newer_policy
            WHERE newer_policy.company_id = outbox.company_id
              AND newer_policy.source_key = outbox.source_key
              AND newer_policy.record_type = outbox.record_type
              AND newer_policy.policy_version > policy.policy_version
          )
          AND record.pulled_at
            + make_interval(days => policy.retention_days) > p_now
          AND octet_length(record.payload::TEXT) <= 4194304
        ORDER BY
          CASE WHEN ledger.attempt_count > 0 THEN 0 ELSE 1 END,
          outbox.available_at, outbox.created_at, outbox.id
        LIMIT LEAST(company_allowance * 4, 2400)
        FOR UPDATE OF outbox SKIP LOCKED
      ), projected AS MATERIALIZED (
        SELECT
          outbox.*,
          policy.id AS policy_id,
          policy.approved_field_paths,
          policy.maximum_content_bytes,
          policy.classification,
          policy.retention_days,
          policy.projection_version,
          workflow_private.context_project_payload(
            record.payload,
            policy.approved_field_paths
          )::TEXT AS projected_content,
          record.source_id,
          record.external_id,
          record.pulled_at,
          record.payload,
          ledger.attempt_count > 0 AS is_admitted
        FROM base
        JOIN public.context_index_outbox outbox ON outbox.id = base.id
        JOIN public.context_index_ledger ledger
          ON ledger.company_id = outbox.company_id
         AND ledger.provider = outbox.provider
         AND ledger.canonical_record_id = outbox.canonical_record_id
        JOIN public.context_indexing_policy_versions policy
          ON policy.company_id = outbox.company_id
         AND policy.source_key = outbox.source_key
         AND policy.record_type = outbox.record_type
         AND policy.policy_version = outbox.policy_version
        JOIN public.external_records record
          ON record.id = outbox.canonical_record_id
         AND record.company_id = outbox.company_id
      ), eligible AS (
        SELECT
          projected.*,
          sum(CASE WHEN projected.is_admitted THEN 0 ELSE 1 END) OVER (
            ORDER BY projected.is_admitted DESC,
              projected.available_at, projected.created_at, projected.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS new_canary_ordinal
        FROM projected
        WHERE workflow_private.context_sha256(projected.projected_content)
            = projected.content_hash
          AND octet_length(projected.projected_content)
            <= projected.maximum_content_bytes
      )
      SELECT eligible.*
      FROM eligible
      WHERE eligible.is_admitted
        OR eligible.new_canary_ordinal
          <= GREATEST(controls.canary_record_limit - canary_claims, 0)
      ORDER BY eligible.is_admitted DESC,
        eligible.available_at, eligible.created_at, eligible.id
      LIMIT company_allowance
    LOOP
      lease_id_value := gen_random_uuid();
      lease_expires_value := p_now + make_interval(secs => p_lease_seconds);

      UPDATE public.context_index_outbox
      SET delivery_state = 'leased',
          attempt_count = attempt_count + 1,
          lease_id = lease_id_value,
          lease_owner = p_worker_id,
          lease_expires_at = lease_expires_value,
          safe_error_code = NULL,
          reserved_cost_microunits =
            controls.estimated_operation_cost_microunits,
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
        candidate.company_id, candidate.provider, candidate.id,
        candidate.job_id, 'claimed', 'add', candidate.attempt_count + 1,
        controls.estimated_operation_cost_microunits, p_now
      );

      claims := claims || jsonb_build_array(jsonb_build_object(
        'outboxId', candidate.id,
        'leaseId', lease_id_value,
        'leaseExpiresAt', lease_expires_value,
        'companyId', candidate.company_id,
        'provider', candidate.provider,
        'operation', 'add',
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
        'sourceId', candidate.source_id,
        'externalId', candidate.external_id,
        'observedAt', candidate.pulled_at,
        'attempt', candidate.attempt_count + 1,
        'maxAttempts', controls.max_attempts,
        'approvedFieldPaths', candidate.approved_field_paths,
        'maximumContentBytes', candidate.maximum_content_bytes,
        'classification', candidate.classification,
        'retentionDays', candidate.retention_days,
        'projectionVersion', candidate.projection_version,
        'projectedContent', candidate.projected_content,
        'canonicalPayload', candidate.payload
      ));
    END LOOP;

    IF jsonb_array_length(claims) > claims_before_company THEN
      INSERT INTO public.context_index_events(
        company_id, provider, event_type, operation, attempt_count,
        estimated_cost_microunits, created_at
      ) VALUES (
        controls.company_id, controls.provider, 'provider_batch_claimed',
        'add', jsonb_array_length(claims) - claims_before_company, 0, p_now
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_context_index_add_batch_v1(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_context_index_add_batch_v1(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ
) TO service_role;

COMMENT ON FUNCTION public.claim_context_index_add_batch_v1(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ
) IS
  'Claims up to 600 policy-safe add operations for one Supermemory batch request while preserving per-document leases, spend controls, and audit events.';
