-- Settle an outcome-unknown provider write only after a later Supermemory
-- inventory read proves the exact stable custom id and provider document id.
-- The canonical record and current policy must still match the dispatched
-- hashes; otherwise the row remains quarantined for manual reconciliation.
CREATE FUNCTION public.confirm_context_provider_batch_outcomes_v1(
  p_company_id UUID,
  p_documents JSONB,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  document JSONB;
  target public.context_index_outbox%ROWTYPE;
  provider_document_id_value TEXT;
  stable_custom_id_value TEXT;
  supplied_count INTEGER;
  settled_count INTEGER := 0;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF p_company_id IS NULL
    OR p_now IS NULL
    OR jsonb_typeof(p_documents) IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'invalid_context_provider_batch_confirmation'
      USING ERRCODE = '22023';
  END IF;

  supplied_count := jsonb_array_length(p_documents);
  IF supplied_count NOT BETWEEN 1 AND 600
    OR (
      SELECT count(DISTINCT item ->> 'customId') <> supplied_count
      FROM jsonb_array_elements(p_documents) item
    )
  THEN
    RAISE EXCEPTION 'invalid_context_provider_batch_confirmation'
      USING ERRCODE = '22023';
  END IF;

  FOR document IN SELECT value FROM jsonb_array_elements(p_documents)
  LOOP
    IF jsonb_typeof(document) IS DISTINCT FROM 'object'
      OR EXISTS (
        SELECT 1
        FROM jsonb_object_keys(document) key
        WHERE key NOT IN ('customId', 'providerDocumentId', 'status')
      )
      OR document ->> 'status' NOT IN ('done', 'complete')
    THEN
      RAISE EXCEPTION 'invalid_context_provider_batch_confirmation'
        USING ERRCODE = '22023';
    END IF;

    stable_custom_id_value := document ->> 'customId';
    provider_document_id_value := document ->> 'providerDocumentId';
    IF stable_custom_id_value IS NULL
      OR stable_custom_id_value !~ '^ctx_[a-f0-9]{64}$'
      OR length(COALESCE(provider_document_id_value, '')) NOT BETWEEN 1 AND 500
    THEN
      RAISE EXCEPTION 'invalid_context_provider_batch_confirmation'
        USING ERRCODE = '22023';
    END IF;

    SELECT outbox.* INTO target
    FROM public.context_index_outbox outbox
    JOIN public.external_records source_record
      ON source_record.company_id = outbox.company_id
     AND source_record.id = outbox.canonical_record_id
    JOIN public.external_sources source
      ON source.company_id = source_record.company_id
     AND source.id = source_record.source_id
     AND source.source_key = outbox.source_key
    JOIN public.context_indexing_policy_versions policy
      ON policy.company_id = outbox.company_id
     AND policy.source_key = outbox.source_key
     AND policy.record_type = outbox.record_type
     AND policy.policy_version = outbox.policy_version
    WHERE outbox.company_id = p_company_id
      AND outbox.provider = 'supermemory'
      AND outbox.stable_custom_id = stable_custom_id_value
      AND outbox.delivery_state = 'needs_reconciliation'
      AND outbox.safe_error_code IN (
        'provider_outcome_unknown',
        'dispatch_outcome_unknown'
      )
      AND outbox.operation IN ('add', 'replace')
      AND policy.indexing_enabled
      AND workflow_private.context_policy_hash(policy) = outbox.policy_hash
      AND NOT EXISTS (
        SELECT 1
        FROM public.context_indexing_policy_versions newer_policy
        WHERE newer_policy.company_id = policy.company_id
          AND newer_policy.source_key = policy.source_key
          AND newer_policy.record_type = policy.record_type
          AND newer_policy.policy_version > policy.policy_version
      )
      AND source_record.pulled_at
        + make_interval(days => policy.retention_days) > p_now
      AND workflow_private.context_sha256(
        jsonb_build_object(
          'recordId', source_record.id,
          'sourceId', source_record.source_id,
          'recordType', source_record.record_type,
          'externalId', source_record.external_id,
          'payload', source_record.payload
        )::TEXT
      ) = outbox.canonical_version
      AND workflow_private.context_sha256(
        workflow_private.context_project_payload(
          source_record.payload,
          policy.approved_field_paths
        )::TEXT
      ) = outbox.content_hash
    FOR UPDATE OF outbox;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.context_index_outbox
    SET delivery_state = 'completed',
        provider_result_document_id = provider_document_id_value,
        provider_processing_status = 'complete',
        provider_accepted_at = COALESCE(provider_accepted_at, p_now),
        provider_checked_at = p_now,
        lease_id = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        safe_error_code = NULL,
        reserved_cost_microunits = 0,
        terminal_at = p_now,
        updated_at = p_now
    WHERE id = target.id;

    UPDATE public.context_index_ledger
    SET provider_document_id = provider_document_id_value,
        status = 'indexed',
        last_indexed_at = p_now,
        last_verified_at = p_now,
        last_error_at = NULL,
        safe_error_code = NULL,
        updated_at = p_now
    WHERE company_id = target.company_id
      AND provider = target.provider
      AND canonical_record_id = target.canonical_record_id;

    INSERT INTO public.context_index_events(
      company_id, provider, outbox_id, job_id, event_type, operation,
      attempt_count, safe_error_code, created_at
    ) VALUES (
      target.company_id, target.provider, target.id, target.job_id,
      'completed', target.operation, target.attempt_count,
      'provider_inventory_confirmed', p_now
    );

    IF target.job_id IS NOT NULL THEN
      UPDATE public.context_index_jobs
      SET completed_count = completed_count + 1,
          failed_count = failed_count - 1,
          status = CASE
            WHEN completed_count + failed_count >= queued_count THEN
              CASE WHEN failed_count - 1 > 0 THEN 'failed' ELSE 'completed' END
            ELSE 'running'
          END,
          completed_at = CASE
            WHEN completed_count + failed_count >= queued_count THEN p_now
            ELSE NULL
          END
      WHERE id = target.job_id
        AND company_id = target.company_id
        AND failed_count > 0;
    END IF;

    settled_count := settled_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'suppliedCount', supplied_count,
    'settledCount', settled_count,
    'unmatchedCount', supplied_count - settled_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_context_provider_batch_outcomes_v1(
  UUID, JSONB, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_context_provider_batch_outcomes_v1(
  UUID, JSONB, TIMESTAMPTZ
) TO service_role;

COMMENT ON FUNCTION public.confirm_context_provider_batch_outcomes_v1(
  UUID, JSONB, TIMESTAMPTZ
) IS
  'Settles outcome-unknown context writes only from exact, completed Supermemory inventory evidence and unchanged canonical policy hashes.';
