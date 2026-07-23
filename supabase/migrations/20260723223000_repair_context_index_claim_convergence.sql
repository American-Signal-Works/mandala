-- Keep provider identity and operation semantics aligned when canonical data
-- changes while an asynchronous add is still processing.
CREATE OR REPLACE FUNCTION workflow_private.enqueue_context_index_record(
  record public.external_records,
  p_job_id UUID DEFAULT NULL,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source_key_value TEXT;
  policy public.context_indexing_policy_versions%ROWTYPE;
  existing_ledger public.context_index_ledger%ROWTYPE;
  canonical_version_value TEXT;
  policy_hash_value TEXT;
  content_hash_value TEXT;
  stable_custom_id_value TEXT;
  operation_value TEXT;
  idempotency_key_value TEXT;
  outbox_id_value UUID;
  ledger_found BOOLEAN := false;
BEGIN
  SELECT source.source_key INTO source_key_value
  FROM public.external_sources source
  WHERE source.id = record.source_id
    AND source.company_id = record.company_id;

  IF source_key_value IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT candidate.* INTO policy
  FROM public.context_indexing_policy_versions candidate
  WHERE candidate.company_id = record.company_id
    AND candidate.source_key = source_key_value
    AND candidate.record_type = record.record_type
  ORDER BY candidate.policy_version DESC
  LIMIT 1;

  IF NOT FOUND OR NOT policy.indexing_enabled THEN
    RETURN NULL;
  END IF;
  IF record.pulled_at + make_interval(days => policy.retention_days) <= p_now THEN
    PERFORM workflow_private.enqueue_context_index_deletion(
      record.company_id, 'supermemory', record.id, 'retention_expired', p_now
    );
    RETURN NULL;
  END IF;

  canonical_version_value := workflow_private.context_sha256(
    jsonb_build_object(
      'recordId', record.id,
      'sourceId', record.source_id,
      'recordType', record.record_type,
      'externalId', record.external_id,
      'payload', record.payload
    )::TEXT
  );
  policy_hash_value := workflow_private.context_policy_hash(policy);
  content_hash_value := workflow_private.context_sha256(
    workflow_private.context_project_payload(
      record.payload,
      policy.approved_field_paths
    )::TEXT
  );
  stable_custom_id_value := 'ctx_' || workflow_private.context_sha256(
    record.company_id::TEXT || ':supermemory:' || record.id::TEXT
  );

  SELECT ledger.* INTO existing_ledger
  FROM public.context_index_ledger ledger
  WHERE ledger.company_id = record.company_id
    AND ledger.provider = 'supermemory'
    AND ledger.canonical_record_id = record.id
  FOR UPDATE;
  ledger_found := FOUND;

  IF ledger_found
    AND existing_ledger.canonical_version = canonical_version_value
    AND existing_ledger.policy_hash = policy_hash_value
    AND existing_ledger.content_hash = content_hash_value
    AND existing_ledger.status IN ('pending', 'indexed')
  THEN
    RETURN NULL;
  END IF;

  -- Once a provider identity exists, every later write is a replacement even
  -- if the original asynchronous add has not finished polling yet.
  operation_value := CASE
    WHEN ledger_found AND existing_ledger.provider_document_id IS NOT NULL
    THEN 'replace'
    ELSE 'add'
  END;
  idempotency_key_value := workflow_private.context_sha256(
    record.company_id::TEXT || ':supermemory:' || record.id::TEXT || ':' ||
    operation_value || ':' || canonical_version_value || ':' || policy_hash_value || ':' ||
    content_hash_value
  );
  IF EXISTS (
    SELECT 1
    FROM public.context_index_outbox existing_event
    WHERE existing_event.idempotency_key = idempotency_key_value
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE public.context_index_outbox outbox
  SET delivery_state = 'superseded',
      terminal_at = p_now,
      safe_error_code = 'superseded_by_newer_version',
      updated_at = p_now,
      lease_id = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL
  WHERE outbox.company_id = record.company_id
    AND outbox.provider = 'supermemory'
    AND outbox.canonical_record_id = record.id
    AND outbox.operation IN ('add', 'replace')
    AND outbox.delivery_state IN ('pending', 'retry');

  INSERT INTO public.context_index_ledger(
    company_id, provider, canonical_record_id, source_key, record_type,
    canonical_version, policy_version, policy_hash, content_hash,
    stable_custom_id, provider_document_id, status, first_queued_at, updated_at
  ) VALUES (
    record.company_id, 'supermemory', record.id, source_key_value, record.record_type,
    canonical_version_value, policy.policy_version, policy_hash_value,
    content_hash_value, stable_custom_id_value,
    CASE WHEN ledger_found THEN existing_ledger.provider_document_id ELSE NULL END,
    'pending', p_now, p_now
  )
  ON CONFLICT (company_id, provider, canonical_record_id)
  DO UPDATE SET
    source_key = EXCLUDED.source_key,
    record_type = EXCLUDED.record_type,
    canonical_version = EXCLUDED.canonical_version,
    policy_version = EXCLUDED.policy_version,
    policy_hash = EXCLUDED.policy_hash,
    content_hash = EXCLUDED.content_hash,
    status = 'pending',
    safe_error_code = NULL,
    updated_at = p_now;

  INSERT INTO public.context_index_outbox(
    company_id, provider, canonical_record_id, source_key, record_type,
    operation, canonical_version, policy_version, policy_hash, content_hash,
    stable_custom_id, provider_document_id, idempotency_key, job_id,
    available_at, created_at, updated_at
  ) VALUES (
    record.company_id, 'supermemory', record.id, source_key_value, record.record_type,
    operation_value, canonical_version_value, policy.policy_version, policy_hash_value,
    content_hash_value, stable_custom_id_value,
    CASE WHEN ledger_found THEN existing_ledger.provider_document_id ELSE NULL END,
    idempotency_key_value, p_job_id,
    p_now, p_now, p_now
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO outbox_id_value;

  IF outbox_id_value IS NOT NULL THEN
    INSERT INTO public.context_index_events(
      company_id, provider, outbox_id, job_id, event_type, operation, attempt_count, created_at
    ) VALUES (
      record.company_id, 'supermemory', outbox_id_value, p_job_id,
      'enqueued', operation_value, 0, p_now
    );
  END IF;
  RETURN outbox_id_value;
END;
$$;

-- The runtime no longer sends replacement work through the legacy all-purpose
-- selector. Bound the candidate set before projection and hashing so queue size
-- cannot turn one cron invocation into a full-corpus scan.
CREATE INDEX context_index_outbox_pending_replace_company_idx
  ON public.context_index_outbox(
    company_id, provider, available_at, created_at, id
  )
  WHERE delivery_state IN ('pending', 'retry')
    AND operation = 'replace'
    AND provider_document_id IS NOT NULL;

CREATE FUNCTION public.claim_context_index_replace_v1(
  p_worker_id TEXT,
  p_limit INTEGER DEFAULT 25,
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
  minute_claims INTEGER;
  daily_claims INTEGER;
  daily_cost BIGINT;
  company_allowance INTEGER;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF length(COALESCE(p_worker_id, '')) NOT BETWEEN 1 AND 120
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lease_seconds NOT BETWEEN 15 AND 900
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_index_replace_claim_request'
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
      AND control.canary_record_limit > 0
      AND control.daily_cost_cap_microunits > 0
    ORDER BY control.company_id, control.provider
    FOR UPDATE OF control
  LOOP
    EXIT WHEN jsonb_array_length(claims) >= p_limit;

    SELECT count(*)::INTEGER INTO minute_claims
    FROM public.context_index_events event
    WHERE event.company_id = controls.company_id
      AND event.provider = controls.provider
      AND event.event_type = 'claimed'
      AND event.created_at > p_now - INTERVAL '1 minute';

    SELECT count(*)::INTEGER INTO daily_claims
    FROM public.context_index_events event
    WHERE event.company_id = controls.company_id
      AND event.provider = controls.provider
      AND event.event_type = 'claimed'
      AND event.created_at >= date_trunc('day', p_now);

    SELECT COALESCE(sum(
      event.estimated_cost_microunits + event.cost_adjustment_microunits
    ), 0)::BIGINT INTO daily_cost
    FROM public.context_index_events event
    WHERE event.company_id = controls.company_id
      AND event.provider = controls.provider
      AND event.created_at >= date_trunc('day', p_now);

    company_allowance := LEAST(
      p_limit - jsonb_array_length(claims),
      controls.requests_per_minute - minute_claims,
      controls.daily_operation_cap - daily_claims,
      floor(
        (controls.daily_cost_cap_microunits - daily_cost)::NUMERIC
        / controls.estimated_operation_cost_microunits::NUMERIC
      )::INTEGER
    );
    IF company_allowance <= 0 THEN
      CONTINUE;
    END IF;

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
          AND outbox.operation = 'replace'
          AND outbox.provider_document_id IS NOT NULL
          AND outbox.available_at <= p_now
          AND outbox.attempt_count < controls.max_attempts
          AND ledger.provider_document_id = outbox.provider_document_id
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
        ORDER BY outbox.available_at, outbox.created_at, outbox.id
        LIMIT LEAST(company_allowance * 4, 400)
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
          record.payload
        FROM base
        JOIN public.context_index_outbox outbox ON outbox.id = base.id
        JOIN public.context_indexing_policy_versions policy
          ON policy.company_id = outbox.company_id
         AND policy.source_key = outbox.source_key
         AND policy.record_type = outbox.record_type
         AND policy.policy_version = outbox.policy_version
        JOIN public.external_records record
          ON record.id = outbox.canonical_record_id
         AND record.company_id = outbox.company_id
      )
      SELECT projected.*
      FROM projected
      WHERE workflow_private.context_sha256(projected.projected_content)
          = projected.content_hash
        AND octet_length(projected.projected_content)
          <= projected.maximum_content_bytes
      ORDER BY projected.available_at, projected.created_at, projected.id
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
        candidate.job_id, 'claimed', 'replace', candidate.attempt_count + 1,
        controls.estimated_operation_cost_microunits, p_now
      );

      claims := claims || jsonb_build_array(jsonb_build_object(
        'outboxId', candidate.id,
        'leaseId', lease_id_value,
        'leaseExpiresAt', lease_expires_value,
        'companyId', candidate.company_id,
        'provider', candidate.provider,
        'operation', 'replace',
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
  END LOOP;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_context_index_replace_v1(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_context_index_replace_v1(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ
) TO service_role;

COMMENT ON FUNCTION public.claim_context_index_replace_v1(
  TEXT, INTEGER, INTEGER, TIMESTAMPTZ
) IS
  'Claims a bounded candidate window of provider-identified replacement work without scanning the full pending queue.';

-- Terminalize malformed active add identities. If the row still represents
-- current canonical content and policy, re-enqueue that exact identity as a
-- replacement. Stale rows remain terminal and cannot be replayed.
WITH malformed_current AS MATERIALIZED (
  SELECT malformed.*
  FROM public.context_index_outbox malformed
  JOIN public.external_records record
    ON record.id = malformed.canonical_record_id
   AND record.company_id = malformed.company_id
  JOIN public.context_indexing_policy_versions policy
    ON policy.company_id = malformed.company_id
   AND policy.source_key = malformed.source_key
   AND policy.record_type = malformed.record_type
   AND policy.policy_version = malformed.policy_version
  WHERE malformed.operation = 'add'
    AND malformed.provider_document_id IS NOT NULL
    AND malformed.delivery_state IN (
      'pending', 'retry', 'leased', 'awaiting_provider', 'needs_reconciliation'
    )
    AND policy.indexing_enabled
    AND workflow_private.context_policy_hash(policy) = malformed.policy_hash
    AND workflow_private.context_sha256(
      workflow_private.context_project_payload(
        record.payload, policy.approved_field_paths
      )::TEXT
    ) = malformed.content_hash
), superseded AS (
  UPDATE public.context_index_outbox active
  SET delivery_state = 'superseded',
      terminal_at = clock_timestamp(),
      safe_error_code = 'repaired_invalid_add_identity',
      lease_id = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      reserved_cost_microunits = 0,
      updated_at = clock_timestamp()
  WHERE (
      active.operation = 'add'
      AND active.provider_document_id IS NOT NULL
      AND active.delivery_state IN (
        'pending', 'retry', 'leased', 'awaiting_provider', 'needs_reconciliation'
      )
    )
    OR (
      active.delivery_state IN ('pending', 'retry')
      AND EXISTS (
        SELECT 1
        FROM malformed_current current
        WHERE current.company_id = active.company_id
          AND current.provider = active.provider
          AND current.canonical_record_id = active.canonical_record_id
      )
    )
  RETURNING active.id
), repaired AS (
  INSERT INTO public.context_index_outbox(
    company_id, provider, canonical_record_id, source_key, record_type,
    operation, canonical_version, policy_version, policy_hash, content_hash,
    stable_custom_id, provider_document_id, idempotency_key, job_id,
    available_at, created_at, updated_at
  )
  SELECT
    current.company_id, current.provider, current.canonical_record_id,
    current.source_key, current.record_type, 'replace',
    current.canonical_version, current.policy_version, current.policy_hash,
    current.content_hash, current.stable_custom_id,
    current.provider_document_id,
    workflow_private.context_sha256(
      current.company_id::TEXT || ':' || current.provider || ':' ||
      current.canonical_record_id::TEXT || ':replace:' ||
      current.canonical_version || ':' || current.policy_hash || ':' ||
      current.content_hash
    ),
    current.job_id, clock_timestamp(), clock_timestamp(), clock_timestamp()
  FROM malformed_current current
  ON CONFLICT (idempotency_key) DO UPDATE
  SET delivery_state = 'pending',
      available_at = EXCLUDED.available_at,
      terminal_at = NULL,
      safe_error_code = NULL,
      lease_id = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      reserved_cost_microunits = 0,
      updated_at = EXCLUDED.updated_at
  RETURNING id, company_id, provider, operation, job_id
)
INSERT INTO public.context_index_events(
  company_id, provider, outbox_id, job_id, event_type, operation,
  attempt_count, safe_error_code, created_at
)
SELECT
  repaired.company_id, repaired.provider, repaired.id, repaired.job_id,
  'enqueued', repaired.operation, 0, 'repaired_invalid_add_identity',
  clock_timestamp()
FROM repaired;

UPDATE public.context_index_ledger ledger
SET status = 'pending',
    safe_error_code = NULL,
    updated_at = clock_timestamp()
WHERE EXISTS (
  SELECT 1
  FROM public.context_index_outbox replacement
  WHERE replacement.company_id = ledger.company_id
    AND replacement.provider = ledger.provider
    AND replacement.canonical_record_id = ledger.canonical_record_id
    AND replacement.operation = 'replace'
    AND replacement.delivery_state = 'pending'
    AND replacement.safe_error_code IS NULL
);
