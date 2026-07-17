-- Cycle 0.0.8 Slice 4: exact, tenant-isolated Context indexing foundation.
--
-- This migration intentionally installs no provider client or schedule. Every
-- operational control starts disabled and all worker mutation entry points are
-- service-role-only. Canonical payloads are never persisted in the ledger,
-- outbox, tombstones, jobs, or events.

CREATE TABLE public.context_index_operation_controls (
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'supermemory' CHECK (provider = 'supermemory'),
  worker_enabled BOOLEAN NOT NULL DEFAULT false,
  canary_record_limit INTEGER NOT NULL DEFAULT 0
    CHECK (canary_record_limit BETWEEN 0 AND 10000),
  requests_per_minute INTEGER NOT NULL DEFAULT 10
    CHECK (requests_per_minute BETWEEN 1 AND 1000),
  daily_operation_cap INTEGER NOT NULL DEFAULT 100
    CHECK (daily_operation_cap BETWEEN 1 AND 100000),
  daily_cost_cap_microunits BIGINT NOT NULL DEFAULT 0
    CHECK (daily_cost_cap_microunits BETWEEN 0 AND 1000000000000),
  estimated_operation_cost_microunits BIGINT NOT NULL DEFAULT 1000
    CHECK (estimated_operation_cost_microunits BETWEEN 1 AND 1000000000),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, provider)
);

CREATE TABLE public.context_index_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'supermemory'),
  canonical_record_id UUID NOT NULL,
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 150),
  record_type TEXT NOT NULL CHECK (length(record_type) BETWEEN 1 AND 150),
  canonical_version TEXT NOT NULL CHECK (canonical_version ~ '^[a-f0-9]{64}$'),
  policy_version BIGINT NOT NULL CHECK (policy_version > 0),
  policy_hash TEXT NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  stable_custom_id TEXT NOT NULL CHECK (stable_custom_id ~ '^ctx_[a-f0-9]{64}$'),
  provider_document_id TEXT CHECK (
    provider_document_id IS NULL OR length(provider_document_id) BETWEEN 1 AND 500
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'indexed', 'delete_pending', 'deleted', 'error', 'reconcile_required')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  first_queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_indexed_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  deletion_requested_at TIMESTAMPTZ,
  deletion_confirmed_at TIMESTAMPTZ,
  safe_error_code TEXT CHECK (
    safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider, canonical_record_id),
  UNIQUE (id, company_id),
  CHECK (status <> 'deleted' OR deletion_confirmed_at IS NOT NULL)
);

CREATE TABLE public.context_index_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'supermemory'),
  mode TEXT NOT NULL CHECK (mode IN ('dry_run', 'canary', 'reconciliation')),
  policy_hash TEXT NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  query_hash TEXT NOT NULL CHECK (query_hash ~ '^[a-f0-9]{64}$'),
  eligible_count INTEGER NOT NULL CHECK (eligible_count >= 0),
  queued_count INTEGER NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  requested_limit INTEGER NOT NULL CHECK (requested_limit BETWEEN 0 AND 10000),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  actor_kind TEXT NOT NULL DEFAULT 'service_role' CHECK (actor_kind = 'service_role'),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  CHECK (completed_count + failed_count <= queued_count),
  CHECK (
    (status = 'running' AND completed_at IS NULL)
    OR (status IN ('completed', 'failed') AND completed_at IS NOT NULL)
  )
);

CREATE TABLE public.context_index_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'supermemory'),
  canonical_record_id UUID NOT NULL,
  source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 150),
  record_type TEXT NOT NULL CHECK (length(record_type) BETWEEN 1 AND 150),
  operation TEXT NOT NULL CHECK (operation IN ('add', 'replace', 'delete')),
  canonical_version TEXT NOT NULL CHECK (canonical_version ~ '^[a-f0-9]{64}$'),
  policy_version BIGINT NOT NULL CHECK (policy_version > 0),
  policy_hash TEXT NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  stable_custom_id TEXT NOT NULL CHECK (stable_custom_id ~ '^ctx_[a-f0-9]{64}$'),
  provider_document_id TEXT CHECK (
    provider_document_id IS NULL OR length(provider_document_id) BETWEEN 1 AND 500
  ),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (idempotency_key ~ '^[a-f0-9]{64}$'),
  job_id UUID,
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (
    delivery_state IN (
      'pending', 'leased', 'retry', 'completed', 'dead_letter',
      'needs_reconciliation', 'superseded'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_id UUID UNIQUE,
  lease_owner TEXT CHECK (
    lease_owner IS NULL OR (
      length(lease_owner) BETWEEN 1 AND 120
      AND lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  lease_expires_at TIMESTAMPTZ,
  safe_error_code TEXT CHECK (
    safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  ),
  reserved_cost_microunits BIGINT NOT NULL DEFAULT 0
    CHECK (reserved_cost_microunits BETWEEN 0 AND 1000000000),
  terminal_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, company_id),
  FOREIGN KEY (job_id, company_id)
    REFERENCES public.context_index_jobs(id, company_id) ON DELETE CASCADE,
  CHECK (
    (delivery_state = 'leased' AND lease_id IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (delivery_state <> 'leased' AND lease_id IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (
    (delivery_state IN ('completed', 'dead_letter', 'needs_reconciliation', 'superseded') AND terminal_at IS NOT NULL)
    OR (delivery_state NOT IN ('completed', 'dead_letter', 'needs_reconciliation', 'superseded') AND terminal_at IS NULL)
  )
);

CREATE TABLE public.context_index_tombstones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'supermemory'),
  canonical_record_id UUID NOT NULL,
  stable_custom_id TEXT NOT NULL CHECK (stable_custom_id ~ '^ctx_[a-f0-9]{64}$'),
  provider_document_id TEXT NOT NULL CHECK (length(provider_document_id) BETWEEN 1 AND 500),
  deletion_reason TEXT NOT NULL DEFAULT 'canonical_deleted'
    CHECK (deletion_reason IN ('canonical_deleted', 'policy_disabled', 'retention_expired')),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  delete_outbox_id UUID NOT NULL,
  UNIQUE (company_id, provider, canonical_record_id),
  UNIQUE (delete_outbox_id),
  FOREIGN KEY (delete_outbox_id, company_id)
    REFERENCES public.context_index_outbox(id, company_id) ON DELETE CASCADE
);

CREATE TABLE public.context_index_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'supermemory'),
  outbox_id UUID,
  job_id UUID,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'enqueued', 'superseded', 'claimed', 'completed', 'retry_scheduled',
      'dead_lettered', 'reconciliation_required', 'lease_expired',
      'reconciliation_created', 'claim_blocked', 'deletion_confirmed'
    )
  ),
  operation TEXT CHECK (operation IS NULL OR operation IN ('add', 'replace', 'delete')),
  attempt_count INTEGER CHECK (attempt_count IS NULL OR attempt_count >= 0),
  safe_error_code TEXT CHECK (
    safe_error_code IS NULL OR safe_error_code ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  ),
  estimated_cost_microunits BIGINT NOT NULL DEFAULT 0
    CHECK (estimated_cost_microunits BETWEEN 0 AND 1000000000000),
  cost_adjustment_microunits BIGINT NOT NULL DEFAULT 0
    CHECK (cost_adjustment_microunits BETWEEN -1000000000 AND 1000000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (outbox_id, company_id)
    REFERENCES public.context_index_outbox(id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (job_id, company_id)
    REFERENCES public.context_index_jobs(id, company_id) ON DELETE CASCADE
);

CREATE INDEX context_index_ledger_status_idx
  ON public.context_index_ledger(company_id, provider, status, updated_at DESC);
CREATE INDEX context_index_outbox_claim_idx
  ON public.context_index_outbox(delivery_state, available_at, created_at, id);
CREATE INDEX context_index_outbox_record_idx
  ON public.context_index_outbox(company_id, provider, canonical_record_id, created_at DESC);
CREATE INDEX context_index_tombstones_pending_idx
  ON public.context_index_tombstones(company_id, provider, deleted_at)
  WHERE confirmed_at IS NULL;
CREATE INDEX context_index_jobs_company_idx
  ON public.context_index_jobs(company_id, provider, created_at DESC);
CREATE INDEX context_index_events_caps_idx
  ON public.context_index_events(company_id, provider, event_type, created_at DESC);

ALTER TABLE public.context_index_operation_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_index_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_index_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_index_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_index_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_index_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.context_index_operation_controls,
  public.context_index_ledger,
  public.context_index_outbox,
  public.context_index_tombstones,
  public.context_index_jobs,
  public.context_index_events
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.context_index_events_id_seq
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.context_index_outbox IS
  'Identifier/hash-only durable provider work. Canonical payload and provider content are forbidden.';
COMMENT ON TABLE public.context_index_tombstones IS
  'Minimal deletion identity that intentionally survives canonical-record deletion until provider confirmation.';
COMMENT ON TABLE public.context_index_events IS
  'Append-only bounded operational evidence. Raw payloads, provider content, credentials, and unrestricted errors are forbidden.';

CREATE FUNCTION workflow_private.require_context_service_role()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE((SELECT auth.jwt() ->> 'role'), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION workflow_private.context_sha256(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT encode(extensions.digest(convert_to(value, 'UTF8'), 'sha256'), 'hex')
$$;

CREATE FUNCTION workflow_private.context_json_pointer_parts(pointer TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT ARRAY(
    SELECT replace(replace(part, '~1', '/'), '~0', '~')
    FROM unnest(string_to_array(substr(pointer, 2), '/')) WITH ORDINALITY AS item(part, ordinal)
    ORDER BY ordinal
  )
$$;

CREATE FUNCTION workflow_private.context_project_payload(payload JSONB, paths TEXT[])
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_object_agg(path, value ORDER BY path) FILTER (WHERE value IS NOT NULL),
    '{}'::JSONB
  )
  FROM (
    SELECT
      path,
      payload #> workflow_private.context_json_pointer_parts(path) AS value
    FROM unnest(paths) AS path
  ) projected
$$;

CREATE FUNCTION workflow_private.context_policy_hash(
  policy public.context_indexing_policy_versions
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT workflow_private.context_sha256(
    jsonb_build_object(
      'policyId', policy.id,
      'policyVersion', policy.policy_version,
      'sourceKey', policy.source_key,
      'recordType', policy.record_type,
      'approvedFieldPaths', policy.approved_field_paths,
      'maximumContentBytes', policy.maximum_content_bytes,
      'classification', policy.classification,
      'retentionDays', policy.retention_days,
      'projectionVersion', policy.projection_version
    )::TEXT
  )
$$;

CREATE FUNCTION workflow_private.initialize_context_index_controls()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.context_index_operation_controls(company_id, provider)
  VALUES (NEW.id, 'supermemory')
  ON CONFLICT (company_id, provider) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companies_initialize_context_index_controls
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION workflow_private.initialize_context_index_controls();

INSERT INTO public.context_index_operation_controls(company_id, provider)
SELECT company.id, 'supermemory'
FROM public.companies company
ON CONFLICT (company_id, provider) DO NOTHING;

CREATE FUNCTION workflow_private.reject_context_outbox_identity_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.provider IS DISTINCT FROM OLD.provider
    OR NEW.canonical_record_id IS DISTINCT FROM OLD.canonical_record_id
    OR NEW.source_key IS DISTINCT FROM OLD.source_key
    OR NEW.record_type IS DISTINCT FROM OLD.record_type
    OR NEW.operation IS DISTINCT FROM OLD.operation
    OR NEW.canonical_version IS DISTINCT FROM OLD.canonical_version
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.policy_hash IS DISTINCT FROM OLD.policy_hash
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.stable_custom_id IS DISTINCT FROM OLD.stable_custom_id
    OR NEW.provider_document_id IS DISTINCT FROM OLD.provider_document_id
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'context_outbox_event_identity_is_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER context_index_outbox_identity_immutable
BEFORE UPDATE ON public.context_index_outbox
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_context_outbox_identity_change();

CREATE FUNCTION workflow_private.reject_context_event_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND pg_trigger_depth() > 1
    AND NOT EXISTS (
      SELECT 1 FROM public.companies company WHERE company.id = OLD.company_id
    )
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'context_index_event_is_append_only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER context_index_events_append_only
BEFORE UPDATE OR DELETE ON public.context_index_events
FOR EACH ROW EXECUTE FUNCTION workflow_private.reject_context_event_change();

CREATE FUNCTION workflow_private.enqueue_context_index_record(
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

  operation_value := CASE
    WHEN ledger_found
      AND existing_ledger.provider_document_id IS NOT NULL
      AND existing_ledger.status IN ('indexed', 'error', 'reconcile_required')
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

CREATE FUNCTION workflow_private.enqueue_context_index_record_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM workflow_private.enqueue_context_index_record(NEW, NULL, now());
  RETURN NULL;
END;
$$;

CREATE TRIGGER external_records_enqueue_context_index
AFTER INSERT OR UPDATE ON public.external_records
FOR EACH ROW EXECUTE FUNCTION workflow_private.enqueue_context_index_record_trigger();

CREATE FUNCTION workflow_private.enqueue_context_index_deletion(
  p_company_id UUID,
  p_provider TEXT,
  p_canonical_record_id UUID,
  p_reason TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ledger public.context_index_ledger%ROWTYPE;
  outbox_id_value UUID;
  idempotency_key_value TEXT;
BEGIN
  IF p_reason NOT IN ('canonical_deleted', 'policy_disabled', 'retention_expired') THEN
    RAISE EXCEPTION 'invalid_context_index_deletion_reason' USING ERRCODE = '22023';
  END IF;

  SELECT candidate.* INTO ledger
  FROM public.context_index_ledger candidate
  WHERE candidate.company_id = p_company_id
    AND candidate.provider = p_provider
    AND candidate.canonical_record_id = p_canonical_record_id
    AND candidate.status <> 'deleted'
    AND candidate.provider_document_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  idempotency_key_value := workflow_private.context_sha256(
    ledger.company_id::TEXT || ':' || ledger.provider || ':' ||
    ledger.canonical_record_id::TEXT || ':delete:' ||
    ledger.canonical_version || ':' || ledger.provider_document_id
  );

  UPDATE public.context_index_outbox outbox
  SET delivery_state = 'superseded',
      terminal_at = p_now,
      safe_error_code = 'superseded_by_deletion',
      updated_at = p_now,
      lease_id = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      reserved_cost_microunits = 0
  WHERE outbox.company_id = ledger.company_id
    AND outbox.provider = ledger.provider
    AND outbox.canonical_record_id = ledger.canonical_record_id
    AND outbox.operation IN ('add', 'replace')
    AND outbox.delivery_state IN ('pending', 'retry');

  UPDATE public.context_index_outbox outbox
  SET delivery_state = 'superseded',
      terminal_at = p_now,
      safe_error_code = 'superseded_by_newer_deletion_identity',
      updated_at = p_now,
      lease_id = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      reserved_cost_microunits = 0
  WHERE outbox.company_id = ledger.company_id
    AND outbox.provider = ledger.provider
    AND outbox.canonical_record_id = ledger.canonical_record_id
    AND outbox.operation = 'delete'
    AND outbox.idempotency_key <> idempotency_key_value
    AND outbox.delivery_state IN ('pending', 'retry');

  INSERT INTO public.context_index_outbox(
    company_id, provider, canonical_record_id, source_key, record_type,
    operation, canonical_version, policy_version, policy_hash, content_hash,
    stable_custom_id, provider_document_id, idempotency_key,
    available_at, created_at, updated_at
  ) VALUES (
    ledger.company_id, ledger.provider, ledger.canonical_record_id,
    ledger.source_key, ledger.record_type, 'delete', ledger.canonical_version,
    ledger.policy_version, ledger.policy_hash, ledger.content_hash,
    ledger.stable_custom_id, ledger.provider_document_id,
    idempotency_key_value, p_now, p_now, p_now
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET available_at = LEAST(public.context_index_outbox.available_at, EXCLUDED.available_at)
  RETURNING id INTO outbox_id_value;

  INSERT INTO public.context_index_tombstones(
    company_id, provider, canonical_record_id, stable_custom_id,
    provider_document_id, deletion_reason, deleted_at, confirmed_at,
    delete_outbox_id
  ) VALUES (
    ledger.company_id, ledger.provider, ledger.canonical_record_id,
    ledger.stable_custom_id, ledger.provider_document_id, p_reason, p_now,
    NULL, outbox_id_value
  )
  ON CONFLICT (company_id, provider, canonical_record_id)
  DO UPDATE SET
    stable_custom_id = EXCLUDED.stable_custom_id,
    provider_document_id = EXCLUDED.provider_document_id,
    deletion_reason = EXCLUDED.deletion_reason,
    delete_outbox_id = EXCLUDED.delete_outbox_id,
    deleted_at = LEAST(public.context_index_tombstones.deleted_at, EXCLUDED.deleted_at),
    confirmed_at = NULL;

  UPDATE public.context_index_ledger
  SET status = 'delete_pending',
      deletion_requested_at = p_now,
      deletion_confirmed_at = NULL,
      updated_at = p_now
  WHERE id = ledger.id;

  IF NOT EXISTS (
    SELECT 1 FROM public.context_index_events event
    WHERE event.outbox_id = outbox_id_value
      AND event.event_type = 'enqueued'
  ) THEN
    INSERT INTO public.context_index_events(
      company_id, provider, outbox_id, event_type, operation,
      attempt_count, created_at
    ) VALUES (
      ledger.company_id, ledger.provider, outbox_id_value,
      'enqueued', 'delete', 0, p_now
    );
  END IF;
  RETURN outbox_id_value;
END;
$$;

CREATE FUNCTION workflow_private.capture_context_index_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM workflow_private.enqueue_context_index_deletion(
    OLD.company_id, 'supermemory', OLD.id, 'canonical_deleted', clock_timestamp()
  );
  RETURN OLD;
END;
$$;

CREATE TRIGGER external_records_capture_context_index_deletion
BEFORE DELETE ON public.external_records
FOR EACH ROW EXECUTE FUNCTION workflow_private.capture_context_index_deletion();

CREATE FUNCTION workflow_private.apply_context_index_policy_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  ledger public.context_index_ledger%ROWTYPE;
  record public.external_records%ROWTYPE;
  now_value TIMESTAMPTZ := clock_timestamp();
BEGIN
  FOR ledger IN
    SELECT candidate.*
    FROM public.context_index_ledger candidate
    WHERE candidate.company_id = NEW.company_id
      AND candidate.provider = 'supermemory'
      AND candidate.source_key = NEW.source_key
      AND candidate.record_type = NEW.record_type
      AND candidate.status <> 'deleted'
    ORDER BY candidate.canonical_record_id
  LOOP
    IF NOT NEW.indexing_enabled THEN
      PERFORM workflow_private.enqueue_context_index_deletion(
        ledger.company_id, ledger.provider, ledger.canonical_record_id,
        'policy_disabled', now_value
      );
      CONTINUE;
    END IF;

    SELECT source_record.* INTO record
    FROM public.external_records source_record
    WHERE source_record.company_id = ledger.company_id
      AND source_record.id = ledger.canonical_record_id;

    IF NOT FOUND THEN
      PERFORM workflow_private.enqueue_context_index_deletion(
        ledger.company_id, ledger.provider, ledger.canonical_record_id,
        'canonical_deleted', now_value
      );
    ELSIF record.pulled_at + make_interval(days => NEW.retention_days) <= now_value THEN
      PERFORM workflow_private.enqueue_context_index_deletion(
        ledger.company_id, ledger.provider, ledger.canonical_record_id,
        'retention_expired', now_value
      );
    ELSE
      PERFORM workflow_private.enqueue_context_index_record(record, NULL, now_value);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER context_indexing_policy_apply_lifecycle
AFTER INSERT ON public.context_indexing_policy_versions
FOR EACH ROW EXECUTE FUNCTION workflow_private.apply_context_index_policy_lifecycle();

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
  invalid RECORD;
  expired public.context_index_outbox%ROWTYPE;
  max_attempts_value INTEGER;
  recovered_count INTEGER := 0;
  dead_lettered_count INTEGER := 0;
  processed_count INTEGER := 0;
  next_state TEXT;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF p_now IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_context_index_prepare_request' USING ERRCODE = '22023';
  END IF;

  FOR invalid IN
    SELECT
      outbox.*,
      CASE
        WHEN record.id IS NULL THEN 'superseded'
        WHEN policy.id IS NULL THEN 'needs_reconciliation'
        WHEN latest_policy.id IS NULL
          OR NOT latest_policy.indexing_enabled
          OR latest_policy.policy_version <> outbox.policy_version
          OR workflow_private.context_policy_hash(latest_policy) <> outbox.policy_hash
        THEN 'superseded'
        WHEN record.pulled_at
          + make_interval(days => policy.retention_days) <= p_now
        THEN 'superseded'
        WHEN octet_length(record.payload::TEXT) > 4194304 THEN 'dead_letter'
        WHEN octet_length(
          workflow_private.context_project_payload(
            record.payload, policy.approved_field_paths
          )::TEXT
        ) > policy.maximum_content_bytes THEN 'dead_letter'
        WHEN workflow_private.context_sha256(
          workflow_private.context_project_payload(
            record.payload, policy.approved_field_paths
          )::TEXT
        ) <> outbox.content_hash THEN 'needs_reconciliation'
        ELSE NULL
      END AS invalid_state,
      CASE
        WHEN record.id IS NULL THEN 'canonical_missing'
        WHEN policy.id IS NULL THEN 'policy_missing'
        WHEN latest_policy.id IS NULL
          OR NOT latest_policy.indexing_enabled
          OR latest_policy.policy_version <> outbox.policy_version
          OR workflow_private.context_policy_hash(latest_policy) <> outbox.policy_hash
        THEN 'stale_policy'
        WHEN record.pulled_at
          + make_interval(days => policy.retention_days) <= p_now
        THEN 'retention_expired'
        WHEN octet_length(record.payload::TEXT) > 4194304 THEN 'canonical_payload_too_large'
        WHEN octet_length(
          workflow_private.context_project_payload(
            record.payload, policy.approved_field_paths
          )::TEXT
        ) > policy.maximum_content_bytes THEN 'projection_too_large'
        WHEN workflow_private.context_sha256(
          workflow_private.context_project_payload(
            record.payload, policy.approved_field_paths
          )::TEXT
        ) <> outbox.content_hash THEN 'content_hash_mismatch'
        ELSE NULL
      END AS invalid_code
    FROM public.context_index_outbox outbox
    LEFT JOIN public.external_records record
      ON record.company_id = outbox.company_id
     AND record.id = outbox.canonical_record_id
    LEFT JOIN public.context_indexing_policy_versions policy
      ON policy.company_id = outbox.company_id
     AND policy.source_key = outbox.source_key
     AND policy.record_type = outbox.record_type
     AND policy.policy_version = outbox.policy_version
     AND workflow_private.context_policy_hash(policy) = outbox.policy_hash
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM public.context_indexing_policy_versions candidate
      WHERE candidate.company_id = outbox.company_id
        AND candidate.source_key = outbox.source_key
        AND candidate.record_type = outbox.record_type
      ORDER BY candidate.policy_version DESC
      LIMIT 1
    ) latest_policy ON true
    WHERE outbox.delivery_state IN ('pending', 'retry')
      AND outbox.operation IN ('add', 'replace')
      AND (
        record.id IS NULL
        OR policy.id IS NULL
        OR latest_policy.id IS NULL
        OR NOT latest_policy.indexing_enabled
        OR latest_policy.policy_version <> outbox.policy_version
        OR workflow_private.context_policy_hash(latest_policy) <> outbox.policy_hash
        OR record.pulled_at + make_interval(days => policy.retention_days) <= p_now
        OR octet_length(record.payload::TEXT) > 4194304
        OR octet_length(
          workflow_private.context_project_payload(
            record.payload, policy.approved_field_paths
          )::TEXT
        ) > policy.maximum_content_bytes
        OR workflow_private.context_sha256(
          workflow_private.context_project_payload(
            record.payload, policy.approved_field_paths
          )::TEXT
        ) <> outbox.content_hash
      )
    ORDER BY outbox.available_at, outbox.id
    LIMIT p_limit
    FOR UPDATE OF outbox SKIP LOCKED
  LOOP
    UPDATE public.context_index_outbox
    SET delivery_state = invalid.invalid_state,
        lease_id = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        reserved_cost_microunits = 0,
        safe_error_code = invalid.invalid_code,
        terminal_at = p_now,
        updated_at = p_now
    WHERE id = invalid.id;

    UPDATE public.context_index_ledger
    SET status = CASE
          WHEN invalid.invalid_state = 'dead_letter' THEN 'error'
          WHEN invalid.invalid_state = 'needs_reconciliation' THEN 'reconcile_required'
          ELSE status
        END,
        safe_error_code = CASE
          WHEN invalid.invalid_state IN ('dead_letter', 'needs_reconciliation')
          THEN invalid.invalid_code
          ELSE safe_error_code
        END,
        last_error_at = CASE
          WHEN invalid.invalid_state IN ('dead_letter', 'needs_reconciliation')
          THEN p_now
          ELSE last_error_at
        END,
        updated_at = p_now
    WHERE company_id = invalid.company_id
      AND provider = invalid.provider
      AND canonical_record_id = invalid.canonical_record_id
      AND canonical_version = invalid.canonical_version;

    INSERT INTO public.context_index_events(
      company_id, provider, outbox_id, job_id, event_type, operation,
      attempt_count, safe_error_code, created_at
    ) VALUES (
      invalid.company_id, invalid.provider, invalid.id, invalid.job_id,
      CASE invalid.invalid_state
        WHEN 'dead_letter' THEN 'dead_lettered'
        WHEN 'needs_reconciliation' THEN 'reconciliation_required'
        ELSE 'superseded'
      END,
      invalid.operation, invalid.attempt_count, invalid.invalid_code, p_now
    );
    IF invalid.invalid_code = 'retention_expired' THEN
      PERFORM workflow_private.enqueue_context_index_deletion(
        invalid.company_id, invalid.provider, invalid.canonical_record_id,
        'retention_expired', p_now
      );
    END IF;
    processed_count := processed_count + 1;
    IF invalid.invalid_state = 'dead_letter' THEN
      dead_lettered_count := dead_lettered_count + 1;
    END IF;
  END LOOP;

  FOR expired IN
    SELECT outbox.*
    FROM public.context_index_outbox outbox
    WHERE outbox.delivery_state = 'leased'
      AND outbox.lease_expires_at <= p_now
    ORDER BY outbox.lease_expires_at, outbox.id
    LIMIT GREATEST(p_limit - processed_count, 0)
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT controls.max_attempts INTO max_attempts_value
    FROM public.context_index_operation_controls controls
    WHERE controls.company_id = expired.company_id
      AND controls.provider = expired.provider;

    next_state := CASE
      WHEN expired.attempt_count >= COALESCE(max_attempts_value, 1) THEN 'dead_letter'
      ELSE 'retry'
    END;

    UPDATE public.context_index_outbox
    SET delivery_state = next_state,
        available_at = p_now,
        lease_id = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        safe_error_code = 'lease_expired',
        terminal_at = CASE WHEN next_state = 'dead_letter' THEN p_now ELSE NULL END,
        updated_at = p_now
    WHERE id = expired.id;

    UPDATE public.context_index_ledger
    SET status = CASE WHEN next_state = 'dead_letter' THEN 'error' ELSE status END,
        safe_error_code = CASE WHEN next_state = 'dead_letter' THEN 'lease_expired' ELSE safe_error_code END,
        last_error_at = CASE WHEN next_state = 'dead_letter' THEN p_now ELSE last_error_at END,
        updated_at = p_now
    WHERE company_id = expired.company_id
      AND provider = expired.provider
      AND canonical_record_id = expired.canonical_record_id;

    INSERT INTO public.context_index_events(
      company_id, provider, outbox_id, job_id, event_type, operation,
      attempt_count, safe_error_code, created_at
    ) VALUES (
      expired.company_id, expired.provider, expired.id, expired.job_id,
      CASE WHEN next_state = 'dead_letter' THEN 'dead_lettered' ELSE 'lease_expired' END,
      expired.operation, expired.attempt_count, 'lease_expired', p_now
    );

    IF next_state = 'dead_letter' THEN
      dead_lettered_count := dead_lettered_count + 1;
    ELSE
      recovered_count := recovered_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'recoveredCount', recovered_count,
    'deadLetteredCount', dead_lettered_count
  );
END;
$$;

CREATE FUNCTION public.claim_context_index_work_v1(
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
    RAISE EXCEPTION 'invalid_context_index_claim_request' USING ERRCODE = '22023';
  END IF;

  -- Serialize gate accounting per company/provider. A concurrent claimant
  -- waits here, then observes the first claimant's committed reservations.
  PERFORM controls.company_id
  FROM public.context_index_operation_controls controls
  WHERE controls.worker_enabled
  ORDER BY controls.company_id, controls.provider
  FOR UPDATE;

  FOR candidate IN
    WITH gate_counts AS (
      SELECT
        controls.*,
        (
          SELECT count(*)::INTEGER
          FROM public.context_index_events event
          WHERE event.company_id = controls.company_id
            AND event.provider = controls.provider
            AND event.event_type = 'claimed'
            AND event.created_at > p_now - INTERVAL '1 minute'
        ) AS minute_claims,
        (
          SELECT count(*)::INTEGER
          FROM public.context_index_events event
          WHERE event.company_id = controls.company_id
            AND event.provider = controls.provider
            AND event.event_type = 'claimed'
            AND event.created_at >= date_trunc('day', p_now)
        ) AS daily_claims,
        (
          SELECT COALESCE(sum(
            event.estimated_cost_microunits + event.cost_adjustment_microunits
          ), 0)::BIGINT
          FROM public.context_index_events event
          WHERE event.company_id = controls.company_id
            AND event.provider = controls.provider
            AND event.created_at >= date_trunc('day', p_now)
        ) AS daily_cost,
        (
          SELECT count(DISTINCT claimed_outbox.canonical_record_id)::INTEGER
          FROM public.context_index_events event
          JOIN public.context_index_outbox claimed_outbox
            ON claimed_outbox.id = event.outbox_id
           AND claimed_outbox.company_id = event.company_id
          WHERE event.company_id = controls.company_id
            AND event.provider = controls.provider
            AND event.event_type = 'claimed'
        ) AS canary_claims
      FROM public.context_index_operation_controls controls
    ), eligible AS (
      SELECT
        outbox.id,
        controls.max_attempts,
        controls.estimated_operation_cost_microunits,
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
        EXISTS (
          SELECT 1
          FROM public.context_index_events admitted_event
          JOIN public.context_index_outbox admitted_outbox
            ON admitted_outbox.id = admitted_event.outbox_id
           AND admitted_outbox.company_id = admitted_event.company_id
          WHERE admitted_event.company_id = outbox.company_id
            AND admitted_event.provider = outbox.provider
            AND admitted_event.event_type = 'claimed'
            AND admitted_outbox.canonical_record_id = outbox.canonical_record_id
        ) AS is_admitted,
        row_number() OVER (
          PARTITION BY outbox.company_id, outbox.provider
          ORDER BY CASE WHEN outbox.operation = 'delete' THEN 0 ELSE 1 END,
          CASE WHEN EXISTS (
            SELECT 1
            FROM public.context_index_events admitted_event
            JOIN public.context_index_outbox admitted_outbox
              ON admitted_outbox.id = admitted_event.outbox_id
             AND admitted_outbox.company_id = admitted_event.company_id
            WHERE admitted_event.company_id = outbox.company_id
              AND admitted_event.provider = outbox.provider
              AND admitted_event.event_type = 'claimed'
              AND admitted_outbox.canonical_record_id = outbox.canonical_record_id
          ) THEN 0 ELSE 1 END,
          outbox.available_at, outbox.created_at, outbox.id
        ) AS company_ordinal,
        sum(
          CASE WHEN EXISTS (
            SELECT 1
            FROM public.context_index_events admitted_event
            JOIN public.context_index_outbox admitted_outbox
              ON admitted_outbox.id = admitted_event.outbox_id
             AND admitted_outbox.company_id = admitted_event.company_id
            WHERE admitted_event.company_id = outbox.company_id
              AND admitted_event.provider = outbox.provider
              AND admitted_event.event_type = 'claimed'
              AND admitted_outbox.canonical_record_id = outbox.canonical_record_id
          ) THEN 0 ELSE 1 END
        ) OVER (
          PARTITION BY outbox.company_id, outbox.provider
          ORDER BY CASE WHEN outbox.operation = 'delete' THEN 0 ELSE 1 END,
          CASE WHEN EXISTS (
            SELECT 1
            FROM public.context_index_events admitted_event
            JOIN public.context_index_outbox admitted_outbox
              ON admitted_outbox.id = admitted_event.outbox_id
             AND admitted_outbox.company_id = admitted_event.company_id
            WHERE admitted_event.company_id = outbox.company_id
              AND admitted_event.provider = outbox.provider
              AND admitted_event.event_type = 'claimed'
              AND admitted_outbox.canonical_record_id = outbox.canonical_record_id
          ) THEN 0 ELSE 1 END,
          outbox.available_at, outbox.created_at, outbox.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS new_canary_ordinal,
        controls.canary_record_limit,
        controls.canary_claims,
        LEAST(
          controls.requests_per_minute - controls.minute_claims,
          controls.daily_operation_cap - controls.daily_claims,
          floor(
            (controls.daily_cost_cap_microunits - controls.daily_cost)::NUMERIC
            / controls.estimated_operation_cost_microunits::NUMERIC
          )::INTEGER
        ) AS company_allowance
      FROM public.context_index_outbox outbox
      JOIN gate_counts controls
        ON controls.company_id = outbox.company_id
       AND controls.provider = outbox.provider
      JOIN public.context_workspace_settings setting
        ON setting.company_id = outbox.company_id
       AND setting.provider = outbox.provider
       AND setting.readiness = 'ready'
      JOIN public.context_indexing_policy_versions policy
        ON policy.company_id = outbox.company_id
       AND policy.source_key = outbox.source_key
       AND policy.record_type = outbox.record_type
       AND policy.policy_version = outbox.policy_version
       AND workflow_private.context_policy_hash(policy) = outbox.policy_hash
      LEFT JOIN public.external_records record
        ON record.id = outbox.canonical_record_id
       AND record.company_id = outbox.company_id
      WHERE outbox.delivery_state IN ('pending', 'retry')
        AND outbox.available_at <= p_now
        AND outbox.attempt_count < controls.max_attempts
        AND controls.worker_enabled
        AND controls.canary_record_limit > 0
        AND controls.minute_claims < controls.requests_per_minute
        AND controls.daily_claims < controls.daily_operation_cap
        AND controls.daily_cost_cap_microunits > 0
        AND controls.daily_cost < controls.daily_cost_cap_microunits
        AND (
          (
            outbox.operation = 'delete'
            AND outbox.provider_document_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.context_index_tombstones tombstone
              WHERE tombstone.company_id = outbox.company_id
                AND tombstone.provider = outbox.provider
                AND tombstone.canonical_record_id = outbox.canonical_record_id
                AND tombstone.delete_outbox_id = outbox.id
                AND tombstone.confirmed_at IS NULL
            )
          )
          OR (
            outbox.operation IN ('add', 'replace')
            AND record.id IS NOT NULL
            AND policy.indexing_enabled
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
            AND workflow_private.context_sha256(
              workflow_private.context_project_payload(
                record.payload,
                policy.approved_field_paths
              )::TEXT
            ) = outbox.content_hash
            AND octet_length(
              workflow_private.context_project_payload(
                record.payload,
                policy.approved_field_paths
              )::TEXT
            ) <= policy.maximum_content_bytes
            AND octet_length(record.payload::TEXT) <= 4194304
          )
        )
    )
    SELECT
      outbox.*,
      eligible.max_attempts,
      eligible.estimated_operation_cost_microunits,
      eligible.policy_id,
      eligible.approved_field_paths,
      eligible.maximum_content_bytes,
      eligible.classification,
      eligible.retention_days,
      eligible.projection_version,
      eligible.projected_content,
      eligible.source_id,
      eligible.external_id,
      eligible.pulled_at,
      eligible.payload
    FROM eligible
    JOIN public.context_index_outbox outbox ON outbox.id = eligible.id
    WHERE eligible.company_ordinal <= eligible.company_allowance
      AND (
        eligible.is_admitted
        OR eligible.new_canary_ordinal
          <= GREATEST(eligible.canary_record_limit - eligible.canary_claims, 0)
      )
    ORDER BY CASE WHEN outbox.operation = 'delete' THEN 0 ELSE 1 END,
      eligible.is_admitted DESC,
      outbox.available_at, outbox.created_at, outbox.id
    LIMIT p_limit
    FOR UPDATE OF outbox SKIP LOCKED
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
      'claimed', candidate.operation, candidate.attempt_count + 1,
      candidate.estimated_operation_cost_microunits, p_now
    );

    claims := claims || jsonb_build_array(jsonb_build_object(
      'outboxId', candidate.id,
      'leaseId', lease_id_value,
      'leaseExpiresAt', lease_expires_value,
      'companyId', candidate.company_id,
      'provider', candidate.provider,
      'operation', candidate.operation,
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
      'sourceId', CASE WHEN candidate.operation = 'delete' THEN NULL ELSE candidate.source_id END,
      'externalId', CASE WHEN candidate.operation = 'delete' THEN NULL ELSE candidate.external_id END,
      'observedAt', CASE WHEN candidate.operation = 'delete' THEN NULL ELSE candidate.pulled_at END,
      'attempt', candidate.attempt_count + 1,
      'maxAttempts', candidate.max_attempts,
      'approvedFieldPaths', candidate.approved_field_paths,
      'maximumContentBytes', candidate.maximum_content_bytes,
      'classification', candidate.classification,
      'retentionDays', candidate.retention_days,
      'projectionVersion', candidate.projection_version,
      'projectedContent', CASE
        WHEN candidate.operation = 'delete' THEN NULL
        ELSE candidate.projected_content
      END,
      'canonicalPayload', CASE
        WHEN candidate.operation = 'delete' THEN NULL
        ELSE candidate.payload
      END
    ));
  END LOOP;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

CREATE FUNCTION public.complete_context_index_work_v1(
  p_worker_id TEXT,
  p_lease_id UUID,
  p_result JSONB,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  leased public.context_index_outbox%ROWTYPE;
  current_record public.external_records%ROWTYPE;
  latest_policy public.context_indexing_policy_versions%ROWTYPE;
  current_source_key TEXT;
  current_canonical_version TEXT;
  current_policy_hash TEXT;
  current_content_hash TEXT;
  provider_document_id_value TEXT;
  estimated_cost_value BIGINT;
  deletion_confirmed BOOLEAN := false;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF length(COALESCE(p_worker_id, '')) NOT BETWEEN 1 AND 120
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_lease_id IS NULL
    OR p_now IS NULL
    OR jsonb_typeof(p_result) IS DISTINCT FROM 'object'
    OR EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_result) AS key
      WHERE key NOT IN ('providerDocumentId', 'estimatedCostMicrounits')
    )
  THEN
    RAISE EXCEPTION 'invalid_context_index_completion' USING ERRCODE = '22023';
  END IF;

  SELECT outbox.* INTO leased
  FROM public.context_index_outbox outbox
  WHERE outbox.lease_id = p_lease_id
    AND outbox.lease_owner = p_worker_id
    AND outbox.delivery_state = 'leased'
    AND outbox.lease_expires_at > p_now
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_index_lease_not_owned_or_expired'
      USING ERRCODE = '40001';
  END IF;

  provider_document_id_value := NULLIF(p_result ->> 'providerDocumentId', '');
  estimated_cost_value := COALESCE((p_result ->> 'estimatedCostMicrounits')::BIGINT, 0);
  IF estimated_cost_value NOT BETWEEN 0 AND leased.reserved_cost_microunits
    OR (provider_document_id_value IS NOT NULL AND length(provider_document_id_value) > 500)
    OR (leased.operation IN ('add', 'replace') AND provider_document_id_value IS NULL)
  THEN
    RAISE EXCEPTION 'invalid_context_index_completion' USING ERRCODE = '22023';
  END IF;

  UPDATE public.context_index_outbox
  SET delivery_state = 'completed',
      lease_id = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      safe_error_code = NULL,
      reserved_cost_microunits = 0,
      terminal_at = p_now,
      updated_at = p_now
  WHERE id = leased.id;

  IF leased.operation = 'delete' THEN
    UPDATE public.context_index_ledger
    SET status = 'deleted',
        deletion_confirmed_at = p_now,
        last_verified_at = p_now,
        safe_error_code = NULL,
        updated_at = p_now
    WHERE company_id = leased.company_id
      AND provider = leased.provider
      AND canonical_record_id = leased.canonical_record_id;
    UPDATE public.context_index_tombstones
    SET confirmed_at = p_now
    WHERE company_id = leased.company_id
      AND provider = leased.provider
      AND canonical_record_id = leased.canonical_record_id
      AND delete_outbox_id = leased.id;
    deletion_confirmed := FOUND;
  ELSE
    -- Retain the accepted provider identity before checking whether the
    -- canonical record/policy changed while the provider call was in flight.
    UPDATE public.context_index_ledger
    SET provider_document_id = provider_document_id_value,
        status = 'reconcile_required',
        last_indexed_at = p_now,
        last_verified_at = p_now,
        safe_error_code = 'completion_fence_pending',
        updated_at = p_now
    WHERE company_id = leased.company_id
      AND provider = leased.provider
      AND canonical_record_id = leased.canonical_record_id;

    SELECT source_record.* INTO current_record
    FROM public.external_records source_record
    WHERE source_record.company_id = leased.company_id
      AND source_record.id = leased.canonical_record_id;

    IF NOT FOUND THEN
      PERFORM workflow_private.enqueue_context_index_deletion(
        leased.company_id, leased.provider, leased.canonical_record_id,
        'canonical_deleted', p_now
      );
    ELSE
      SELECT source.source_key INTO current_source_key
      FROM public.external_sources source
      WHERE source.company_id = current_record.company_id
        AND source.id = current_record.source_id;

      SELECT policy.* INTO latest_policy
      FROM public.context_indexing_policy_versions policy
      WHERE policy.company_id = current_record.company_id
        AND policy.source_key = current_source_key
        AND policy.record_type = current_record.record_type
      ORDER BY policy.policy_version DESC
      LIMIT 1;

      IF NOT FOUND OR NOT latest_policy.indexing_enabled THEN
        PERFORM workflow_private.enqueue_context_index_deletion(
          leased.company_id, leased.provider, leased.canonical_record_id,
          'policy_disabled', p_now
        );
      ELSIF current_record.pulled_at
        + make_interval(days => latest_policy.retention_days) <= p_now
      THEN
        PERFORM workflow_private.enqueue_context_index_deletion(
          leased.company_id, leased.provider, leased.canonical_record_id,
          'retention_expired', p_now
        );
      ELSE
        current_canonical_version := workflow_private.context_sha256(
          jsonb_build_object(
            'recordId', current_record.id,
            'sourceId', current_record.source_id,
            'recordType', current_record.record_type,
            'externalId', current_record.external_id,
            'payload', current_record.payload
          )::TEXT
        );
        current_policy_hash := workflow_private.context_policy_hash(latest_policy);
        current_content_hash := workflow_private.context_sha256(
          workflow_private.context_project_payload(
            current_record.payload, latest_policy.approved_field_paths
          )::TEXT
        );

        IF current_canonical_version = leased.canonical_version
          AND current_policy_hash = leased.policy_hash
          AND current_content_hash = leased.content_hash
        THEN
          UPDATE public.context_index_ledger
          SET source_key = current_source_key,
              record_type = current_record.record_type,
              canonical_version = current_canonical_version,
              policy_version = latest_policy.policy_version,
              policy_hash = current_policy_hash,
              content_hash = current_content_hash,
              provider_document_id = provider_document_id_value,
              status = 'indexed',
              last_error_at = NULL,
              safe_error_code = NULL,
              updated_at = p_now
          WHERE company_id = leased.company_id
            AND provider = leased.provider
            AND canonical_record_id = leased.canonical_record_id;
        ELSE
          -- The update trigger may already have queued an add without knowing
          -- the provider accepted the old lease. Re-enqueue from the now-known
          -- provider identity so that work becomes an exact replacement.
          PERFORM workflow_private.enqueue_context_index_record(
            current_record, leased.job_id, p_now
          );
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.context_index_events(
    company_id, provider, outbox_id, job_id, event_type, operation,
    attempt_count, estimated_cost_microunits, cost_adjustment_microunits, created_at
  ) VALUES (
    leased.company_id, leased.provider, leased.id, leased.job_id,
    'completed', leased.operation, leased.attempt_count,
    0, estimated_cost_value - leased.reserved_cost_microunits, p_now
  );
  IF deletion_confirmed THEN
    INSERT INTO public.context_index_events(
      company_id, provider, outbox_id, job_id, event_type, operation,
      attempt_count, created_at
    ) VALUES (
      leased.company_id, leased.provider, leased.id, leased.job_id,
      'deletion_confirmed', 'delete', leased.attempt_count, p_now
    );
  END IF;

  IF leased.job_id IS NOT NULL THEN
    UPDATE public.context_index_jobs
    SET completed_count = completed_count + 1
    WHERE id = leased.job_id;
    UPDATE public.context_index_jobs
    SET status = CASE WHEN failed_count > 0 THEN 'failed' ELSE 'completed' END,
        completed_at = p_now
    WHERE id = leased.job_id
      AND status = 'running'
      AND completed_count + failed_count >= queued_count;
  END IF;

  RETURN jsonb_build_object(
    'outboxId', leased.id,
    'status', 'completed',
    'operation', leased.operation,
    'deletionConfirmed', deletion_confirmed
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_context_index_completion' USING ERRCODE = '22023';
END;
$$;

CREATE FUNCTION public.fail_context_index_work_v1(
  p_worker_id TEXT,
  p_lease_id UUID,
  p_disposition TEXT,
  p_error_code TEXT,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  leased public.context_index_outbox%ROWTYPE;
  max_attempts_value INTEGER;
  next_state TEXT;
  available_value TIMESTAMPTZ;
  terminal_failure BOOLEAN;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF length(COALESCE(p_worker_id, '')) NOT BETWEEN 1 AND 120
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_lease_id IS NULL
    OR p_disposition NOT IN ('transient', 'permanent', 'unknown')
    OR p_error_code IS NULL
    OR p_error_code !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_index_failure' USING ERRCODE = '22023';
  END IF;

  SELECT outbox.* INTO leased
  FROM public.context_index_outbox outbox
  WHERE outbox.lease_id = p_lease_id
    AND outbox.lease_owner = p_worker_id
    AND outbox.delivery_state = 'leased'
    AND outbox.lease_expires_at > p_now
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_index_lease_not_owned_or_expired'
      USING ERRCODE = '40001';
  END IF;

  SELECT controls.max_attempts INTO max_attempts_value
  FROM public.context_index_operation_controls controls
  WHERE controls.company_id = leased.company_id
    AND controls.provider = leased.provider;

  next_state := CASE
    WHEN p_disposition = 'unknown' THEN 'needs_reconciliation'
    WHEN p_disposition = 'permanent' OR leased.attempt_count >= max_attempts_value THEN 'dead_letter'
    ELSE 'retry'
  END;
  terminal_failure := next_state IN ('dead_letter', 'needs_reconciliation');
  available_value := CASE
    WHEN next_state = 'retry' THEN
      p_now + make_interval(
        secs => LEAST(3600, (30 * power(2, GREATEST(leased.attempt_count - 1, 0)))::INTEGER)
      )
    ELSE NULL
  END;

  UPDATE public.context_index_outbox
  SET delivery_state = next_state,
      available_at = COALESCE(available_value, available_at),
      lease_id = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      safe_error_code = p_error_code,
      reserved_cost_microunits = 0,
      terminal_at = CASE WHEN terminal_failure THEN p_now ELSE NULL END,
      updated_at = p_now
  WHERE id = leased.id;

  UPDATE public.context_index_ledger
  SET status = CASE
        WHEN next_state = 'needs_reconciliation' THEN 'reconcile_required'
        WHEN next_state = 'dead_letter' THEN 'error'
        ELSE status
      END,
      last_error_at = p_now,
      safe_error_code = p_error_code,
      updated_at = p_now
  WHERE company_id = leased.company_id
    AND provider = leased.provider
    AND canonical_record_id = leased.canonical_record_id;

  INSERT INTO public.context_index_events(
    company_id, provider, outbox_id, job_id, event_type, operation,
    attempt_count, safe_error_code, created_at
  ) VALUES (
    leased.company_id, leased.provider, leased.id, leased.job_id,
    CASE next_state
      WHEN 'retry' THEN 'retry_scheduled'
      WHEN 'dead_letter' THEN 'dead_lettered'
      ELSE 'reconciliation_required'
    END,
    leased.operation, leased.attempt_count, p_error_code, p_now
  );

  IF terminal_failure AND leased.job_id IS NOT NULL THEN
    UPDATE public.context_index_jobs
    SET failed_count = failed_count + 1
    WHERE id = leased.job_id;
    UPDATE public.context_index_jobs
    SET status = 'failed', completed_at = p_now
    WHERE id = leased.job_id
      AND status = 'running'
      AND completed_count + failed_count >= queued_count;
  END IF;

  RETURN jsonb_build_object(
    'outboxId', leased.id,
    'status', next_state,
    'availableAt', available_value
  );
END;
$$;

CREATE FUNCTION public.reconcile_context_index_work_v1(
  p_company_id UUID,
  p_mode TEXT DEFAULT 'dry_run',
  p_requested_limit INTEGER DEFAULT 0,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  job_id_value UUID := gen_random_uuid();
  policy_hash_value TEXT;
  snapshot_hash_value TEXT;
  query_hash_value TEXT;
  eligible_count_value INTEGER;
  queued_count_value INTEGER := 0;
  record public.external_records%ROWTYPE;
  expired_ledger public.context_index_ledger%ROWTYPE;
  queued_id UUID;
  controls public.context_index_operation_controls%ROWTYPE;
  setting public.context_workspace_settings%ROWTYPE;
  queue_limit INTEGER := 0;
  terminal_status TEXT;
BEGIN
  PERFORM workflow_private.require_context_service_role();
  IF p_company_id IS NULL
    OR p_mode NOT IN ('dry_run', 'canary', 'reconciliation')
    OR p_requested_limit NOT BETWEEN 0 AND 10000
    OR p_now IS NULL
  THEN
    RAISE EXCEPTION 'invalid_context_index_reconciliation' USING ERRCODE = '22023';
  END IF;

  SELECT target.* INTO controls
  FROM public.context_index_operation_controls target
  WHERE target.company_id = p_company_id
    AND target.provider = 'supermemory';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_index_workspace_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT target.* INTO setting
  FROM public.context_workspace_settings target
  WHERE target.company_id = p_company_id;

  WITH latest_policies AS (
    SELECT DISTINCT ON (policy.source_key, policy.record_type) policy.*
    FROM public.context_indexing_policy_versions policy
    WHERE policy.company_id = p_company_id
    ORDER BY policy.source_key, policy.record_type, policy.policy_version DESC
  ), eligible AS (
    SELECT
      source_record.id,
      workflow_private.context_sha256(
        jsonb_build_object(
          'recordId', source_record.id,
          'sourceId', source_record.source_id,
          'recordType', source_record.record_type,
          'externalId', source_record.external_id,
          'payload', source_record.payload
        )::TEXT
      ) AS canonical_version,
      workflow_private.context_policy_hash(policy) AS policy_hash
    FROM public.external_records source_record
    JOIN public.external_sources source
      ON source.id = source_record.source_id
     AND source.company_id = source_record.company_id
    JOIN latest_policies policy
      ON policy.source_key = source.source_key
     AND policy.record_type = source_record.record_type
     AND policy.indexing_enabled
    WHERE source_record.company_id = p_company_id
      AND source_record.pulled_at
        + make_interval(days => policy.retention_days) > p_now
  )
  SELECT
    count(*)::INTEGER,
    workflow_private.context_sha256(
      COALESCE(string_agg(id::TEXT || ':' || canonical_version || ':' || policy_hash, '|' ORDER BY id), 'empty')
    )
  INTO eligible_count_value, snapshot_hash_value
  FROM eligible;

  SELECT workflow_private.context_sha256(
    COALESCE(string_agg(
      workflow_private.context_policy_hash(policy),
      '|' ORDER BY policy.source_key, policy.record_type, policy.policy_version
    ), 'empty')
  ) INTO policy_hash_value
  FROM (
    SELECT DISTINCT ON (candidate.source_key, candidate.record_type) candidate.*
    FROM public.context_indexing_policy_versions candidate
    WHERE candidate.company_id = p_company_id
    ORDER BY candidate.source_key, candidate.record_type, candidate.policy_version DESC
  ) policy
  WHERE policy.indexing_enabled;

  query_hash_value := workflow_private.context_sha256(
    jsonb_build_object(
      'schemaVersion', 1,
      'companyId', p_company_id,
      'provider', 'supermemory',
      'mode', p_mode,
      'requestedLimit', p_requested_limit
    )::TEXT
  );

  IF p_mode <> 'dry_run'
    AND controls.worker_enabled
    AND controls.canary_record_limit > 0
    AND setting.provider = 'supermemory'
    AND setting.readiness = 'ready'
  THEN
    queue_limit := LEAST(p_requested_limit, controls.canary_record_limit);
  END IF;

  IF p_mode <> 'dry_run' THEN
    FOR expired_ledger IN
      WITH latest_policies AS (
        SELECT DISTINCT ON (policy.source_key, policy.record_type) policy.*
        FROM public.context_indexing_policy_versions policy
        WHERE policy.company_id = p_company_id
        ORDER BY policy.source_key, policy.record_type, policy.policy_version DESC
      )
      SELECT ledger.*
      FROM public.context_index_ledger ledger
      JOIN public.external_records source_record
        ON source_record.company_id = ledger.company_id
       AND source_record.id = ledger.canonical_record_id
      JOIN latest_policies policy
        ON policy.source_key = ledger.source_key
       AND policy.record_type = ledger.record_type
       AND policy.indexing_enabled
      WHERE ledger.company_id = p_company_id
        AND ledger.provider = 'supermemory'
        AND ledger.provider_document_id IS NOT NULL
        AND ledger.status <> 'deleted'
        AND source_record.pulled_at
          + make_interval(days => policy.retention_days) <= p_now
      ORDER BY ledger.canonical_record_id
    LOOP
      PERFORM workflow_private.enqueue_context_index_deletion(
        expired_ledger.company_id, expired_ledger.provider,
        expired_ledger.canonical_record_id, 'retention_expired', p_now
      );
    END LOOP;
  END IF;

  INSERT INTO public.context_index_jobs(
    id, company_id, provider, mode, policy_hash, snapshot_hash, query_hash,
    eligible_count, queued_count, requested_limit, status, started_at,
    completed_at, created_at
  ) VALUES (
    job_id_value, p_company_id, 'supermemory', p_mode, policy_hash_value,
    snapshot_hash_value, query_hash_value, eligible_count_value, 0,
    p_requested_limit, 'running', p_now, NULL, p_now
  );

  IF queue_limit > 0 THEN
    FOR record IN
      WITH latest_policies AS (
        SELECT DISTINCT ON (policy.source_key, policy.record_type) policy.*
        FROM public.context_indexing_policy_versions policy
        WHERE policy.company_id = p_company_id
        ORDER BY policy.source_key, policy.record_type, policy.policy_version DESC
      )
      SELECT source_record.*
      FROM public.external_records source_record
      JOIN public.external_sources source
        ON source.id = source_record.source_id
       AND source.company_id = source_record.company_id
      JOIN latest_policies policy
        ON policy.source_key = source.source_key
       AND policy.record_type = source_record.record_type
       AND policy.indexing_enabled
      WHERE source_record.company_id = p_company_id
        AND source_record.pulled_at
          + make_interval(days => policy.retention_days) > p_now
      ORDER BY source_record.id
      LIMIT queue_limit
    LOOP
      queued_id := workflow_private.enqueue_context_index_record(
        record, job_id_value, p_now
      );
      IF queued_id IS NOT NULL THEN
        queued_count_value := queued_count_value + 1;
      END IF;
    END LOOP;
  END IF;

  terminal_status := CASE WHEN queued_count_value = 0 THEN 'completed' ELSE 'running' END;
  UPDATE public.context_index_jobs
  SET queued_count = queued_count_value,
      status = terminal_status,
      completed_at = CASE WHEN terminal_status = 'completed' THEN p_now ELSE NULL END
  WHERE id = job_id_value;

  INSERT INTO public.context_index_events(
    company_id, provider, job_id, event_type, created_at
  ) VALUES (
    p_company_id, 'supermemory', job_id_value, 'reconciliation_created', p_now
  );

  RETURN jsonb_build_object(
    'jobId', job_id_value,
    'companyId', p_company_id,
    'provider', 'supermemory',
    'mode', p_mode,
    'status', terminal_status,
    'eligibleCount', eligible_count_value,
    'queuedCount', queued_count_value,
    'policyHash', policy_hash_value,
    'snapshotHash', snapshot_hash_value,
    'queryHash', query_hash_value
  );
END;
$$;

CREATE FUNCTION public.get_context_index_status_v1(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor UUID := (SELECT auth.uid());
  controls public.context_index_operation_controls%ROWTYPE;
  latest_job public.context_index_jobs%ROWTYPE;
  ledger_count INTEGER;
  indexed_count INTEGER;
  recent_error_count INTEGER;
  last_synchronized TIMESTAMPTZ;
  evidence_available BOOLEAN;
  eligible_count_value INTEGER;
  coverage_value NUMERIC;
  lag_seconds_value BIGINT;
BEGIN
  PERFORM workflow_private.require_company_role(p_company_id, 'viewer', actor);

  SELECT target.* INTO controls
  FROM public.context_index_operation_controls target
  WHERE target.company_id = p_company_id
    AND target.provider = 'supermemory';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'context_index_workspace_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT job.* INTO latest_job
  FROM public.context_index_jobs job
  WHERE job.company_id = p_company_id
    AND job.provider = 'supermemory'
    AND job.status IN ('completed', 'failed')
  ORDER BY job.completed_at DESC, job.id DESC
  LIMIT 1;

  SELECT
    count(*)::INTEGER,
    count(*) FILTER (WHERE ledger.status = 'indexed')::INTEGER,
    max(COALESCE(ledger.last_verified_at, ledger.last_indexed_at, ledger.deletion_confirmed_at))
  INTO ledger_count, indexed_count, last_synchronized
  FROM public.context_index_ledger ledger
  WHERE ledger.company_id = p_company_id
    AND ledger.provider = 'supermemory';

  SELECT count(*)::INTEGER INTO recent_error_count
  FROM public.context_index_events event
  WHERE event.company_id = p_company_id
    AND event.provider = 'supermemory'
    AND event.event_type IN ('dead_lettered', 'reconciliation_required', 'lease_expired')
    AND event.created_at >= now() - INTERVAL '24 hours';

  evidence_available := latest_job.id IS NOT NULL OR ledger_count > 0;
  eligible_count_value := CASE
    WHEN latest_job.id IS NOT NULL THEN latest_job.eligible_count
    ELSE NULL
  END;
  -- Slice 4 does not persist frozen snapshot membership, so a historical
  -- ledger count cannot be safely divided by a later job's eligible count.
  -- Keep coverage unavailable until a later slice has exact membership proof.
  coverage_value := NULL;
  lag_seconds_value := CASE
    WHEN last_synchronized IS NULL THEN NULL
    ELSE GREATEST(0, floor(extract(epoch FROM (now() - last_synchronized)))::BIGINT)
  END;

  RETURN jsonb_build_object(
    'companyId', p_company_id,
    'provider', 'supermemory',
    'evidenceAvailable', evidence_available,
    'eligibleCount', eligible_count_value,
    'indexedCount', CASE WHEN evidence_available THEN indexed_count ELSE NULL END,
    'coveragePercent', coverage_value,
    'lagSeconds', lag_seconds_value,
    'lastSynchronizedAt', last_synchronized,
    'recentErrorCount', CASE WHEN evidence_available THEN recent_error_count ELSE NULL END,
    'workerEnabled', controls.worker_enabled,
    'canaryRecordLimit', controls.canary_record_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION workflow_private.require_context_service_role()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.context_sha256(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.context_json_pointer_parts(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.context_project_payload(JSONB, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.context_policy_hash(public.context_indexing_policy_versions)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.initialize_context_index_controls()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.reject_context_outbox_identity_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.reject_context_event_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.enqueue_context_index_record(
  public.external_records, UUID, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.enqueue_context_index_record_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.enqueue_context_index_deletion(
  UUID, TEXT, UUID, TEXT, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.capture_context_index_deletion()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION workflow_private.apply_context_index_policy_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.prepare_context_index_work_v1(TIMESTAMPTZ, INTEGER)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_context_index_work_v1(TEXT, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_context_index_work_v1(TEXT, UUID, JSONB, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_context_index_work_v1(TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reconcile_context_index_work_v1(UUID, TEXT, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_context_index_status_v1(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.prepare_context_index_work_v1(TIMESTAMPTZ, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_context_index_work_v1(TEXT, INTEGER, INTEGER, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_context_index_work_v1(TEXT, UUID, JSONB, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_context_index_work_v1(TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_context_index_work_v1(UUID, TEXT, INTEGER, TIMESTAMPTZ)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_context_index_status_v1(UUID)
  TO authenticated;
