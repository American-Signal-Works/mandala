BEGIN;
SELECT plan(23);
SELECT set_config('test.reconciliation_now', now()::TEXT, true);

SELECT has_function(
  'public', 'claim_context_index_reconciliation_v1',
  ARRAY['text','integer','timestamp with time zone'],
  'bounded reconciliation claim RPC exists'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.claim_context_index_reconciliation_v1(text,integer,timestamp with time zone)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot claim reconciliation work'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.claim_context_index_reconciliation_v1(text,integer,timestamp with time zone)',
    'EXECUTE'
  ),
  false,
  'members cannot claim reconciliation work'
);
SELECT is(
  has_function_privilege(
    'service_role',
    'public.claim_context_index_reconciliation_v1(text,integer,timestamp with time zone)',
    'EXECUTE'
  ),
  true,
  'service role may claim reconciliation work'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'b1100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'reconcile-owner@example.test', '', now(),
  '{}', '{}', now(), now()
);
INSERT INTO public.companies(id, name, created_by) VALUES (
  'b1200000-0000-4000-8000-000000000001',
  'Reconciliation Tenant',
  'b1100000-0000-4000-8000-000000000001'
), (
  'c1200000-0000-4000-8000-000000000001',
  'Second Reconciliation Tenant',
  'b1100000-0000-4000-8000-000000000001'
);
INSERT INTO public.company_memberships(company_id, user_id, role, status)
VALUES (
  'b1200000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'owner', 'active'
), (
  'c1200000-0000-4000-8000-000000000001',
  'b1100000-0000-4000-8000-000000000001',
  'owner', 'active'
);
INSERT INTO public.external_sources(
  id, company_id, source_key, kind, name
) VALUES (
  'b1300000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'helpdesk', 'service', 'Reconciliation Helpdesk'
), (
  'c1300000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'helpdesk', 'service', 'Second Reconciliation Helpdesk'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'b1100000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"b1100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT public.publish_context_indexing_policy_v1(
  'b1200000-0000-4000-8000-000000000001',
  'helpdesk', 'support_ticket', 0, true,
  ARRAY['/ticket_id','/summary'], 65536, 'internal', 30, 1,
  'Reconciliation worker regression policy.'
);
SELECT public.publish_context_indexing_policy_v1(
  'c1200000-0000-4000-8000-000000000001',
  'helpdesk', 'support_ticket', 0, true,
  ARRAY['/ticket_id','/summary'], 65536, 'internal', 30, 1,
  'Second reconciliation tenant regression policy.'
);
UPDATE public.context_workspace_settings
SET provider = 'supermemory', readiness = 'ready'
WHERE company_id IN (
  'b1200000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001'
);
UPDATE public.context_index_operation_controls
SET worker_enabled = true,
    provider_health_status = 'healthy',
    provider_health_checked_at =
      current_setting('test.reconciliation_now')::TIMESTAMPTZ,
    canary_record_limit = 100,
    requests_per_minute = 100,
    daily_operation_cap = 1000,
    daily_cost_cap_microunits = 1000000,
    estimated_operation_cost_microunits = 1000,
    max_attempts = 5
WHERE company_id IN (
  'b1200000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001'
);

INSERT INTO public.external_records(
  id, company_id, source_id, record_type, external_id, payload, pulled_at
) VALUES
(
  'b1400000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001',
  'support_ticket', 'RECON-1',
  '{"ticket_id":"RECON-1","summary":"unknown add"}',
  current_setting('test.reconciliation_now')::TIMESTAMPTZ
),
(
  'b1400000-0000-4000-8000-000000000002',
  'b1200000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001',
  'support_ticket', 'RECON-2',
  '{"ticket_id":"RECON-2","summary":"processing timeout"}',
  current_setting('test.reconciliation_now')::TIMESTAMPTZ
),
(
  'b1400000-0000-4000-8000-000000000003',
  'b1200000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001',
  'support_ticket', 'RECON-3',
  '{"ticket_id":"RECON-3","summary":"stale"}',
  current_setting('test.reconciliation_now')::TIMESTAMPTZ
),
(
  'c1400000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'support_ticket', 'RECON-SECOND-1',
  '{"ticket_id":"RECON-SECOND-1","summary":"second tenant"}',
  current_setting('test.reconciliation_now')::TIMESTAMPTZ
);

UPDATE public.context_index_outbox
SET delivery_state = 'needs_reconciliation',
    safe_error_code = CASE canonical_record_id
      WHEN 'b1400000-0000-4000-8000-000000000002'::UUID
        THEN 'provider_processing_timeout'
      ELSE 'provider_outcome_unknown'
    END,
    available_at = CASE canonical_record_id
      WHEN 'b1400000-0000-4000-8000-000000000002'::UUID
        THEN current_setting('test.reconciliation_now')::TIMESTAMPTZ
          + INTERVAL '1 second'
      ELSE current_setting('test.reconciliation_now')::TIMESTAMPTZ
    END,
    terminal_at = current_setting('test.reconciliation_now')::TIMESTAMPTZ
WHERE canonical_record_id IN (
  'b1400000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000002',
  'b1400000-0000-4000-8000-000000000003',
  'c1400000-0000-4000-8000-000000000001'
);
UPDATE public.context_index_ledger
SET status = 'reconcile_required',
    safe_error_code = 'provider_outcome_unknown'
WHERE canonical_record_id IN (
  'b1400000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000002',
  'b1400000-0000-4000-8000-000000000003',
  'c1400000-0000-4000-8000-000000000001'
);

-- Make the third candidate stale after its unknown write. The trigger creates
-- fresh pending work, while the old reconciliation row must remain excluded.
UPDATE public.external_records
SET payload = '{"ticket_id":"RECON-3","summary":"new version"}',
    pulled_at = current_setting('test.reconciliation_now')::TIMESTAMPTZ
      + INTERVAL '1 second'
WHERE id = 'b1400000-0000-4000-8000-000000000003';

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
CREATE TEMP TABLE reconciliation_claim(payload JSONB) ON COMMIT DROP;
INSERT INTO reconciliation_claim(payload)
SELECT public.claim_context_index_reconciliation_v1(
  'reconcile-worker', 1,
  current_setting('test.reconciliation_now')::TIMESTAMPTZ
);

SELECT is(
  jsonb_array_length((SELECT payload->'claims' FROM reconciliation_claim)),
  1,
  'claim is bounded to the requested batch size'
);
SELECT is(
  (
    SELECT payload->'claims'->0->>'companyId'
    FROM reconciliation_claim
  ),
  'b1200000-0000-4000-8000-000000000001',
  'claim is tenant scoped'
);
SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM jsonb_object_keys(
      (SELECT payload->'claims'->0 FROM reconciliation_claim)
    ) key
    WHERE key NOT IN (
      'outboxId','companyId','provider','stableCustomId','attempt','nextAttemptAt'
    )
  ),
  0,
  'claim exposes only payload-free reconciliation references'
);
SELECT is(
  (
    SELECT poll_attempt_count
    FROM public.context_index_outbox
    WHERE id = (
      SELECT (payload->'claims'->0->>'outboxId')::UUID
      FROM reconciliation_claim
    )
  ),
  1,
  'claim increments the inventory poll attempt before a provider call'
);
SELECT is(
  (
    SELECT reconciliation_claim_owner
    FROM public.context_index_outbox
    WHERE id = (
      SELECT (payload->'claims'->0->>'outboxId')::UUID
      FROM reconciliation_claim
    )
  ),
  'reconcile-worker',
  'the bounded claim records its validated worker identity for audit'
);
SELECT is(
  (
    SELECT available_at
    FROM public.context_index_outbox
    WHERE id = (
      SELECT (payload->'claims'->0->>'outboxId')::UUID
      FROM reconciliation_claim
    )
  ),
  current_setting('test.reconciliation_now')::TIMESTAMPTZ
    + INTERVAL '5 minutes',
  'unmatched work is quarantined with initial backoff'
);
UPDATE public.context_index_operation_controls
SET daily_operation_cap = 1
WHERE company_id = 'b1200000-0000-4000-8000-000000000001';
UPDATE public.context_index_operation_controls
SET worker_enabled = false
WHERE company_id = 'c1200000-0000-4000-8000-000000000001';
SELECT is(
  jsonb_array_length(
    public.claim_context_index_reconciliation_v1(
      'reconcile-worker', 1,
      current_setting('test.reconciliation_now')::TIMESTAMPTZ
    )->'claims'
  ),
  0,
  'reconciliation reads stop at the workspace daily operation cap'
);
UPDATE public.context_index_operation_controls
SET daily_operation_cap = 100
WHERE company_id = 'b1200000-0000-4000-8000-000000000001';
UPDATE public.context_index_operation_controls
SET worker_enabled = true
WHERE company_id = 'c1200000-0000-4000-8000-000000000001';
CREATE TEMP TABLE fair_reconciliation_claim(payload JSONB) ON COMMIT DROP;
INSERT INTO fair_reconciliation_claim(payload)
SELECT public.claim_context_index_reconciliation_v1(
  'reconcile-worker', 1,
  current_setting('test.reconciliation_now')::TIMESTAMPTZ
);
SELECT is(
  (
    SELECT payload->'claims'->0->>'companyId'
    FROM fair_reconciliation_claim
  ),
  'c1200000-0000-4000-8000-000000000001',
  'the least recently reconciled tenant progresses before a low-ID backlog repeats'
);
UPDATE public.context_index_outbox
SET poll_attempt_count = 1000
WHERE canonical_record_id = 'b1400000-0000-4000-8000-000000000002';
CREATE TEMP TABLE second_reconciliation_claim(payload JSONB) ON COMMIT DROP;
INSERT INTO second_reconciliation_claim(payload)
SELECT public.claim_context_index_reconciliation_v1(
  'reconcile-worker', 1,
  current_setting('test.reconciliation_now')::TIMESTAMPTZ
    + INTERVAL '1 second'
);
SELECT is(
  jsonb_array_length(
    (SELECT payload->'claims' FROM second_reconciliation_claim)
  ),
  1,
  'another current unknown outcome may progress without bypassing backoff'
);
SELECT is(
  (
    SELECT (payload->'claims'->0->>'attempt')::INTEGER
    FROM second_reconciliation_claim
  ),
  1000,
  'the public claim envelope keeps very old retry counters schema-safe'
);
SELECT is(
  (
    SELECT poll_attempt_count
    FROM public.context_index_outbox
    WHERE canonical_record_id = 'b1400000-0000-4000-8000-000000000002'
  ),
  1000,
  'very old retry counters stay capped instead of poisoning maintenance'
);
SELECT is(
  public.confirm_context_provider_batch_outcomes_v1(
    'b1200000-0000-4000-8000-000000000099',
    jsonb_build_array(jsonb_build_object(
      'customId', (
        SELECT payload->'claims'->0->>'stableCustomId'
        FROM reconciliation_claim
      ),
      'providerDocumentId', 'wrong-tenant-document',
      'status', 'complete'
    )),
    current_setting('test.reconciliation_now')::TIMESTAMPTZ
  )->>'settledCount',
  '0',
  'confirmation cannot cross tenant boundaries'
);
SELECT is(
  public.confirm_context_provider_batch_outcomes_v1(
    'b1200000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'customId', (
        SELECT payload->'claims'->0->>'stableCustomId'
        FROM reconciliation_claim
      ),
      'providerDocumentId', 'confirmed-provider-document',
      'status', 'complete'
    )),
    current_setting('test.reconciliation_now')::TIMESTAMPTZ
  )->>'settledCount',
  '1',
  'an exact completed inventory match settles once'
);
SELECT is(
  public.confirm_context_provider_batch_outcomes_v1(
    'b1200000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'customId', (
        SELECT payload->'claims'->0->>'stableCustomId'
        FROM reconciliation_claim
      ),
      'providerDocumentId', 'confirmed-provider-document',
      'status', 'complete'
    )),
    current_setting('test.reconciliation_now')::TIMESTAMPTZ
  )->>'settledCount',
  '0',
  'repeat confirmation is idempotent'
);
SELECT is(
  public.confirm_context_provider_batch_outcomes_v1(
    'b1200000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'customId', (
        SELECT payload->'claims'->0->>'stableCustomId'
        FROM second_reconciliation_claim
      ),
      'providerDocumentId', 'timeout-confirmed-document',
      'status', 'complete'
    )),
    current_setting('test.reconciliation_now')::TIMESTAMPTZ
  )->>'settledCount',
  '1',
  'a processing-timeout exact match settles without resending the add'
);
SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM public.context_index_outbox
    WHERE canonical_record_id = 'b1400000-0000-4000-8000-000000000003'
      AND delivery_state = 'needs_reconciliation'
      AND available_at > current_setting('test.reconciliation_now')::TIMESTAMPTZ
  ),
  0,
  'stale canonical versions are never claimed'
);
SELECT throws_ok(
  $$SELECT public.claim_context_index_reconciliation_v1(
    'reconcile-worker', 101, now()
  )$$,
  '22023',
  'invalid_context_index_reconciliation_claim',
  'claim rejects batches above 100'
);
SELECT ok(
  position(
    '''provider_processing_timeout'''
    IN pg_get_functiondef(
      'public.confirm_context_provider_batch_outcomes_v1(uuid,jsonb,timestamp with time zone)'::REGPROCEDURE
    )
  ) > 0,
  'processing-timeout exact matches use the same safe confirmation path'
);
SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM public.context_index_events
    WHERE company_id = 'b1200000-0000-4000-8000-000000000001'
      AND safe_error_code = 'provider_inventory_reconciliation_reserved'
  ),
  2,
  'claims record only safe reservation events'
);

SELECT * FROM finish();
ROLLBACK;
