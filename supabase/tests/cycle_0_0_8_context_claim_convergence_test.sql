BEGIN;
SELECT plan(13);
SELECT set_config('test.context_claim_now', now()::TEXT, true);

SELECT has_function(
  'public', 'claim_context_index_replace_v1',
  ARRAY['text','integer','integer','timestamp with time zone'],
  'bounded replacement claim RPC exists'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.claim_context_index_replace_v1(text,integer,integer,timestamp with time zone)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot claim replacement work'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.claim_context_index_replace_v1(text,integer,integer,timestamp with time zone)',
    'EXECUTE'
  ),
  false,
  'members cannot claim replacement work'
);
SELECT is(
  has_function_privilege(
    'service_role',
    'public.claim_context_index_replace_v1(text,integer,integer,timestamp with time zone)',
    'EXECUTE'
  ),
  true,
  'service role may call the checked replacement claim RPC'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'a1100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'claim-owner@example.test', '', now(),
  '{}', '{}', now(), now()
);
INSERT INTO public.companies(id, name, created_by) VALUES (
  'a1200000-0000-4000-8000-000000000001',
  'Claim Convergence Tenant',
  'a1100000-0000-4000-8000-000000000001'
);
INSERT INTO public.company_memberships(company_id, user_id, role, status) VALUES (
  'a1200000-0000-4000-8000-000000000001',
  'a1100000-0000-4000-8000-000000000001',
  'owner', 'active'
);
INSERT INTO public.external_sources(
  id, company_id, source_key, kind, name
) VALUES (
  'a1300000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'helpdesk', 'service', 'Claim Helpdesk'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1100000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SELECT public.publish_context_indexing_policy_v1(
  'a1200000-0000-4000-8000-000000000001',
  'helpdesk', 'support_ticket', 0, true,
  ARRAY['/ticket_id','/summary'], 65536, 'internal', 30, 1,
  'Claim convergence regression policy.'
);
UPDATE public.context_workspace_settings
SET provider = 'supermemory', readiness = 'ready'
WHERE company_id = 'a1200000-0000-4000-8000-000000000001';
UPDATE public.context_index_operation_controls
SET worker_enabled = true,
    canary_record_limit = 100,
    requests_per_minute = 100,
    daily_operation_cap = 1000,
    daily_cost_cap_microunits = 1000000,
    estimated_operation_cost_microunits = 1000,
    max_attempts = 5
WHERE company_id = 'a1200000-0000-4000-8000-000000000001';

INSERT INTO public.external_records(
  id, company_id, source_id, record_type, external_id, payload
) VALUES (
  'a1400000-0000-4000-8000-000000000001',
  'a1200000-0000-4000-8000-000000000001',
  'a1300000-0000-4000-8000-000000000001',
  'support_ticket', 'CLAIM-1',
  '{"ticket_id":"CLAIM-1","summary":"initial"}'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is(
  jsonb_array_length(
    public.claim_context_index_add_batch_v1(
      'claim-worker', 1, 120,
      current_setting('test.context_claim_now')::TIMESTAMPTZ
    )->'claims'
  ),
  1,
  'initial add is leased through the batch path'
);
SELECT is(
  public.accept_context_index_work_v1(
    'claim-worker',
    (
      SELECT lease_id
      FROM public.context_index_outbox
      WHERE canonical_record_id = 'a1400000-0000-4000-8000-000000000001'
        AND operation = 'add'
    ),
    'provider-claim-1',
    current_setting('test.context_claim_now')::TIMESTAMPTZ
      + INTERVAL '1 second'
  )->>'status',
  'awaiting_provider',
  'provider acceptance persists an identity before polling completes'
);

SELECT set_config(
  'request.jwt.claim.sub',
  'a1100000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
UPDATE public.external_records
SET payload = '{"ticket_id":"CLAIM-1","summary":"changed while processing"}',
    pulled_at = current_setting('test.context_claim_now')::TIMESTAMPTZ
      + INTERVAL '2 seconds'
WHERE id = 'a1400000-0000-4000-8000-000000000001';

SELECT is(
  (
    SELECT operation
    FROM public.context_index_outbox
    WHERE canonical_record_id = 'a1400000-0000-4000-8000-000000000001'
      AND delivery_state = 'needs_reconciliation'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  'replace',
  'an update during provider processing queues replacement work, never add work'
);
SELECT is(
  (
    SELECT provider_document_id
    FROM public.context_index_outbox
    WHERE canonical_record_id = 'a1400000-0000-4000-8000-000000000001'
      AND operation = 'replace'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  'provider-claim-1',
  'queued replacement retains the accepted provider identity'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.claim_context_index_processing_v1(
  'poll-worker', 1, 120,
  current_setting('test.context_claim_now')::TIMESTAMPTZ + INTERVAL '3 seconds'
);
SELECT is(
  public.complete_context_index_work_v1(
    'poll-worker',
    (
      SELECT lease_id
      FROM public.context_index_outbox
      WHERE canonical_record_id = 'a1400000-0000-4000-8000-000000000001'
        AND operation = 'add'
        AND delivery_state = 'leased'
    ),
    '{"providerDocumentId":"provider-claim-1","estimatedCostMicrounits":0}',
    current_setting('test.context_claim_now')::TIMESTAMPTZ
      + INTERVAL '4 seconds'
  )->>'status',
  'completed',
  'provider polling completion releases the waiting replacement'
);

CREATE TEMP TABLE claimed_replacement(payload JSONB) ON COMMIT DROP;
INSERT INTO claimed_replacement(payload)
SELECT public.claim_context_index_replace_v1(
  'replace-worker', 1, 120,
  current_setting('test.context_claim_now')::TIMESTAMPTZ + INTERVAL '2 minutes'
);
SELECT is(
  (SELECT payload->'claims'->0->>'operation' FROM claimed_replacement),
  'replace',
  'bounded selector claims the released replacement'
);
SELECT is(
  (
    SELECT payload->'claims'->0->>'providerDocumentId'
    FROM claimed_replacement
  ),
  'provider-claim-1',
  'replacement claim retains the required provider identity'
);
SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM public.context_index_outbox
    WHERE canonical_record_id = 'a1400000-0000-4000-8000-000000000001'
      AND operation = 'add'
      AND provider_document_id IS NOT NULL
  ),
  0,
  'no add outbox identity contains a provider document identifier'
);
SELECT ok(
  position(
    'LIMIT LEAST(company_allowance * 4, 400)'
    IN pg_get_functiondef(
      'public.claim_context_index_replace_v1(text,integer,integer,timestamp with time zone)'::REGPROCEDURE
    )
  ) > 0,
  'replacement selection bounds candidates before projection'
);

SELECT * FROM finish();
ROLLBACK;
