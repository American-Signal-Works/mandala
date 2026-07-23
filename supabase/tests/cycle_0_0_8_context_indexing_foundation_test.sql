BEGIN;
SELECT plan(79);
SELECT set_config('test.context_worker_now', now()::TEXT, true);

-- Structure, RLS, and public surface.
SELECT has_table('public', 'context_index_operation_controls', 'operation controls exist');
SELECT has_table('public', 'context_index_ledger', 'exact index ledger exists');
SELECT has_table('public', 'context_index_outbox', 'durable index outbox exists');
SELECT has_table('public', 'context_index_tombstones', 'deletion tombstones exist');
SELECT has_table('public', 'context_index_jobs', 'reconciliation evidence jobs exist');
SELECT has_table('public', 'context_index_events', 'append-only operational events exist');

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_index_operation_controls'::regclass), 'controls use RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_index_ledger'::regclass), 'ledger uses RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_index_outbox'::regclass), 'outbox uses RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_index_tombstones'::regclass), 'tombstones use RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_index_jobs'::regclass), 'jobs use RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.context_index_events'::regclass), 'events use RLS');

SELECT has_function('public', 'prepare_context_index_work_v1', ARRAY['timestamp with time zone','integer'], 'prepare RPC exists');
SELECT has_function('public', 'claim_context_index_work_v1', ARRAY['text','integer','integer','timestamp with time zone'], 'claim RPC exists');
SELECT has_function('public', 'claim_context_index_add_batch_v1', ARRAY['text','integer','integer','timestamp with time zone'], 'batch-add claim RPC exists');
SELECT has_function('public', 'complete_context_index_work_v1', ARRAY['text','uuid','jsonb','timestamp with time zone'], 'complete RPC exists');
SELECT has_function('public', 'fail_context_index_work_v1', ARRAY['text','uuid','text','text','timestamp with time zone'], 'failure RPC exists');
SELECT has_function('public', 'reconcile_context_index_work_v1', ARRAY['uuid','text','integer','timestamp with time zone'], 'reconciliation RPC exists');
SELECT has_function('public', 'get_context_index_status_v1', ARRAY['uuid'], 'safe status RPC exists');
SELECT has_function('public', 'get_context_retrieval_ledger_v1', ARRAY['uuid','uuid[]'], 'bounded retrieval ledger RPC exists');

SELECT is(has_function_privilege('anon', 'public.claim_context_index_work_v1(text,integer,integer,timestamp with time zone)', 'EXECUTE'), false, 'anonymous cannot claim work');
SELECT is(has_function_privilege('authenticated', 'public.claim_context_index_work_v1(text,integer,integer,timestamp with time zone)', 'EXECUTE'), false, 'members cannot claim work');
SELECT is(has_function_privilege('service_role', 'public.claim_context_index_work_v1(text,integer,integer,timestamp with time zone)', 'EXECUTE'), true, 'service role may call checked claim RPC');
SELECT is(has_function_privilege('anon', 'public.claim_context_index_add_batch_v1(text,integer,integer,timestamp with time zone)', 'EXECUTE'), false, 'anonymous cannot claim batch work');
SELECT is(has_function_privilege('authenticated', 'public.claim_context_index_add_batch_v1(text,integer,integer,timestamp with time zone)', 'EXECUTE'), false, 'members cannot claim batch work');
SELECT is(has_function_privilege('service_role', 'public.claim_context_index_add_batch_v1(text,integer,integer,timestamp with time zone)', 'EXECUTE'), true, 'service role may claim checked batch work');
SELECT is(has_function_privilege('authenticated', 'public.get_context_index_status_v1(uuid)', 'EXECUTE'), true, 'members may call safe status RPC');
SELECT is(has_function_privilege('anon', 'public.get_context_retrieval_ledger_v1(uuid,uuid[])', 'EXECUTE'), false, 'anonymous cannot read retrieval ledger evidence');
SELECT is(has_function_privilege('authenticated', 'public.get_context_retrieval_ledger_v1(uuid,uuid[])', 'EXECUTE'), false, 'members cannot read retrieval ledger evidence');
SELECT is(has_function_privilege('service_role', 'public.get_context_retrieval_ledger_v1(uuid,uuid[])', 'EXECUTE'), true, 'service role may call bounded retrieval ledger RPC');
SELECT is(has_table_privilege('service_role', 'public.context_index_ledger', 'SELECT'), false, 'service role still cannot read the ledger table directly');
SELECT is(has_table_privilege('authenticated', 'public.context_index_outbox', 'SELECT'), false, 'members cannot read raw outbox rows');
SELECT is(has_table_privilege('service_role', 'public.context_index_outbox', 'UPDATE'), false, 'service role cannot bypass worker RPCs');
SELECT is(
  (SELECT count(*)::integer FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('context_index_outbox','context_index_ledger','context_index_tombstones','context_index_jobs','context_index_events')
     AND column_name IN ('payload','content','projected_content','provider_content','credentials')),
  0,
  'operational tables persist no raw payload, projected content, provider content, or credentials'
);

-- Two isolated tenants and canonical sources.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('e1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'index-owner-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'index-viewer-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('e1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'index-owner-b@example.test', '', now(), '{}', '{}', now(), now());
INSERT INTO public.companies(id, name, created_by) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'Index Tenant A', 'e1000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000002', 'Index Tenant B', 'e1000000-0000-4000-8000-000000000003');
INSERT INTO public.company_memberships(company_id, user_id, role, status) VALUES
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'viewer', 'active'),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000003', 'owner', 'active');
INSERT INTO public.external_sources(id, company_id, source_key, kind, name) VALUES
  ('e3000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'helpdesk', 'service', 'Helpdesk A'),
  ('e3000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'helpdesk', 'service', 'Helpdesk B');

SELECT is((SELECT worker_enabled FROM public.context_index_operation_controls WHERE company_id = 'e2000000-0000-4000-8000-000000000001'), false, 'worker defaults disabled');
SELECT is((SELECT canary_record_limit FROM public.context_index_operation_controls WHERE company_id = 'e2000000-0000-4000-8000-000000000001'), 0, 'canary defaults to zero records');
SELECT is((SELECT daily_cost_cap_microunits FROM public.context_index_operation_controls WHERE company_id = 'e2000000-0000-4000-8000-000000000001'), 0::bigint, 'daily cost cap defaults to a hard zero');

INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload)
VALUES ('e4000000-0000-4000-8000-000000000000', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'support_ticket', 'PRE-POLICY', '{"ticket_id":"PRE-POLICY","summary":"not eligible"}');
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox), 0, 'absence of an enabled latest policy denies trigger enqueue');

SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.publish_context_indexing_policy_v1(
    'e2000000-0000-4000-8000-000000000001', 'helpdesk', 'support_ticket',
    0, true, ARRAY['/ticket_id','/summary'], 65536, 'internal', 30, 1,
    'Enable bounded test projection.'
  )$$,
  'owner publishes the enabled bounded policy'
);

INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload)
VALUES ('e4000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'support_ticket', 'A-1', '{"ticket_id":"A-1","summary":"first","secret":"never projected"}');
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'), 1, 'canonical insert enqueues one exact hash-only event');
UPDATE public.external_records SET payload = payload WHERE id = 'e4000000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'), 1, 'identical canonical content is idempotent');
SELECT ok((SELECT stable_custom_id ~ '^ctx_[a-f0-9]{64}$' FROM public.context_index_ledger WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'), 'ledger stores a deterministic provider-neutral custom id');

-- Other tenant has its own evidence and cannot be observed by tenant A members.
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'e2000000-0000-4000-8000-000000000002', 'helpdesk', 'support_ticket',
  0, true, ARRAY['/ticket_id'], 65536, 'internal', 30, 1,
  'Tenant B isolated policy.'
);
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload)
VALUES ('e4000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000002', 'e3000000-0000-4000-8000-000000000002', 'support_ticket', 'B-1', '{"ticket_id":"B-1"}');
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE company_id = 'e2000000-0000-4000-8000-000000000002'), 1, 'tenant B receives a separate exact outbox event');

SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((public.get_context_index_status_v1('e2000000-0000-4000-8000-000000000001')->>'evidenceAvailable')::boolean, true, 'member sees safe evidence for own tenant');
SELECT is(public.get_context_index_status_v1('e2000000-0000-4000-8000-000000000001')->>'coveragePercent', NULL, 'coverage stays unavailable without a proven complete snapshot');
SELECT throws_ok(
  $$SELECT public.get_context_index_status_v1('e2000000-0000-4000-8000-000000000002')$$,
  '42501', 'forbidden', 'member cannot read another tenant status'
);
RESET ROLE;

-- Service-only claims remain blocked by readiness, kill, zero-cost, and near-cap gates.
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.context_workspace_settings
SET provider = 'supermemory', readiness = 'not_ready'
WHERE company_id = 'e2000000-0000-4000-8000-000000000001';
UPDATE public.context_index_operation_controls
SET worker_enabled = true, canary_record_limit = 100,
    daily_cost_cap_microunits = 100000, requests_per_minute = 100,
    daily_operation_cap = 100, max_attempts = 2
WHERE company_id = 'e2000000-0000-4000-8000-000000000001';
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('worker-a', 10, 60, current_setting('test.context_worker_now')::TIMESTAMPTZ)->'claims'), 0, 'not-ready provider blocks every claim');
UPDATE public.context_workspace_settings SET readiness = 'ready' WHERE company_id = 'e2000000-0000-4000-8000-000000000001';
UPDATE public.context_index_operation_controls SET worker_enabled = false WHERE company_id = 'e2000000-0000-4000-8000-000000000001';
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('worker-a', 10, 60, current_setting('test.context_worker_now')::TIMESTAMPTZ)->'claims'), 0, 'worker kill switch blocks every claim');
UPDATE public.context_index_operation_controls SET worker_enabled = true, daily_cost_cap_microunits = 0 WHERE company_id = 'e2000000-0000-4000-8000-000000000001';
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('worker-a', 10, 60, current_setting('test.context_worker_now')::TIMESTAMPTZ)->'claims'), 0, 'zero daily cost cap is a hard claim block');
UPDATE public.context_index_operation_controls SET daily_cost_cap_microunits = 999, estimated_operation_cost_microunits = 1000 WHERE company_id = 'e2000000-0000-4000-8000-000000000001';
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('worker-a', 10, 60, current_setting('test.context_worker_now')::TIMESTAMPTZ)->'claims'), 0, 'claim cannot overshoot a near-exhausted cost cap');
UPDATE public.context_index_operation_controls SET daily_cost_cap_microunits = 100000 WHERE company_id = 'e2000000-0000-4000-8000-000000000001';
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('worker-a', 1, 60, current_setting('test.context_worker_now')::TIMESTAMPTZ)->'claims'), 1, 'all server-owned gates permit one bounded claim');
SELECT is((SELECT delivery_state FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'), 'leased', 'claim owns an explicit lease');
SELECT is((SELECT attempt_count FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'), 1, 'claim atomically increments attempt count');
SELECT is((SELECT reserved_cost_microunits FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'), 1000::bigint, 'claim reserves bounded cost before dispatch');
SELECT throws_ok(
  $$SELECT public.complete_context_index_work_v1(
    'worker-b', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'),
    '{"providerDocumentId":"doc-a1","estimatedCostMicrounits":0}',
    current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '1 second'
  )$$,
  '40001', 'context_index_lease_not_owned_or_expired', 'wrong worker cannot complete another lease'
);
SELECT throws_ok(
  $$SELECT public.complete_context_index_work_v1(
    'worker-a', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'),
    '{"providerDocumentId":"doc-a1","estimatedCostMicrounits":0}',
    current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '61 seconds'
  )$$,
  '40001', 'context_index_lease_not_owned_or_expired', 'expired lease cannot complete'
);
SELECT is(
  public.fail_context_index_work_v1(
    'worker-a', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'),
    'transient', 'provider_timeout',
    current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '2 seconds'
  )->>'status',
  'retry', 'known transient failure schedules retry'
);
SELECT is((SELECT delivery_state FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'), 'retry', 'retry clears the lease and remains nonterminal');
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('worker-a', 1, 60, current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '33 seconds')->'claims'), 1, 'backoff-expired retry can be reclaimed');
SELECT is(
  public.fail_context_index_work_v1(
    'worker-a', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'),
    'transient', 'provider_timeout',
    current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '34 seconds'
  )->>'status',
  'dead_letter', 'bounded attempts turn repeated transient failure into dead letter'
);
SELECT is((SELECT delivery_state FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'), 'dead_letter', 'dead letter is terminal and auditable');

-- Successful fake-provider path followed by privacy-safe deletion.
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload)
VALUES ('e4000000-0000-4000-8000-000000000003', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'support_ticket', 'A-DELETE', '{"ticket_id":"A-DELETE","summary":"delete me"}');
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('worker-a', 1, 60, current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '2 minutes')->'claims'), 1, 'fake provider add is claimable locally');
SELECT is(
  public.complete_context_index_work_v1(
    'worker-a', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000003'),
    '{"providerDocumentId":"provider-doc-delete","estimatedCostMicrounits":500}',
    current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '121 seconds'
  )->>'status',
  'completed', 'fake provider completion persists exact ledger evidence'
);
SELECT is((SELECT status FROM public.context_index_ledger WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000003'), 'indexed', 'ledger records confirmed provider indexing');
SELECT is(
  (SELECT count(*)::integer FROM public.get_context_retrieval_ledger_v1(
    'e2000000-0000-4000-8000-000000000001',
    ARRAY['e4000000-0000-4000-8000-000000000003'::uuid]
  )),
  1,
  'bounded retrieval returns the requested indexed row for the exact tenant'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_context_retrieval_ledger_v1(
    'e2000000-0000-4000-8000-000000000002',
    ARRAY['e4000000-0000-4000-8000-000000000003'::uuid]
  )),
  0,
  'bounded retrieval cannot cross tenant boundaries'
);

SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'e2000000-0000-4000-8000-000000000001', 'helpdesk', 'support_ticket',
  1, false, ARRAY[]::text[], 65536, 'internal', 30, 1,
  'Disable future adds without stranding deletion.'
);
DELETE FROM public.external_records WHERE id = 'e4000000-0000-4000-8000-000000000003';
SELECT is((SELECT count(*)::integer FROM public.context_index_tombstones WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000003' AND confirmed_at IS NULL), 1, 'tombstone survives canonical deletion');
SELECT is((SELECT operation FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000003' AND delivery_state = 'pending'), 'delete', 'delete work survives disabled policy');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is((public.claim_context_index_work_v1('worker-a', 1, 60, current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '4 minutes')->'claims'->0->>'operation'), 'delete', 'disabled/advanced policy cannot strand deletion claim');
SELECT is(
  public.complete_context_index_work_v1(
    'worker-a', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000003' AND operation = 'delete'),
    '{"estimatedCostMicrounits":0}',
    current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '241 seconds'
  )->>'deletionConfirmed',
  'true', 'delete completion confirms the surviving tombstone'
);
SELECT ok((SELECT confirmed_at IS NOT NULL FROM public.context_index_tombstones WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000003'), 'provider deletion confirmation is durable');

-- A newer still-enabled policy also cannot strand an older indexed document's deletion.
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'e2000000-0000-4000-8000-000000000001', 'helpdesk', 'support_ticket',
  2, true, ARRAY['/ticket_id','/summary'], 65536, 'internal', 30, 1,
  'Re-enable the bounded projection.'
);
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload)
VALUES ('e4000000-0000-4000-8000-000000000004', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'support_ticket', 'A-ADVANCE', '{"ticket_id":"A-ADVANCE","summary":"advance policy"}');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.claim_context_index_work_v1(
  'worker-a', 2, 60,
  current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '6 minutes'
);
SELECT is(
  public.complete_context_index_work_v1(
    'worker-a', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000004'),
    '{"providerDocumentId":"provider-doc-advance","estimatedCostMicrounits":0}',
    current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '361 seconds'
  )->>'status',
  'completed', 'second fake provider document is durably indexed before policy advance'
);
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'e2000000-0000-4000-8000-000000000001', 'helpdesk', 'support_ticket',
  3, true, ARRAY['/ticket_id','/summary'], 65536, 'internal', 30, 2,
  'Advance projection version without stranding prior deletion.'
);
DELETE FROM public.external_records WHERE id = 'e4000000-0000-4000-8000-000000000004';
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is((public.claim_context_index_work_v1('worker-a', 1, 60, current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '8 minutes')->'claims'->0->>'operation'), 'delete', 'version-advanced policy cannot strand deletion claim');

-- Reconciliation records frozen hashes/counts but cannot invent coverage.
SELECT is((public.reconcile_context_index_work_v1('e2000000-0000-4000-8000-000000000001', 'dry_run', 100000, current_setting('test.context_worker_now')::TIMESTAMPTZ + INTERVAL '5 minutes')->>'queuedCount')::integer, 0, 'full-corpus dry-run reconciliation never queues provider work');
SELECT ok((SELECT snapshot_hash ~ '^[a-f0-9]{64}$' AND query_hash ~ '^[a-f0-9]{64}$' FROM public.context_index_jobs WHERE company_id = 'e2000000-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 1), 'reconciliation persists frozen snapshot and query evidence');
SELECT set_config('request.jwt.claim.sub', 'e1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"e1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT is(public.get_context_index_status_v1('e2000000-0000-4000-8000-000000000001')->>'coveragePercent', NULL, 'historical ledger and later snapshot counts never fabricate numeric coverage');

-- Lease expiry recovery and immutable operational evidence.
SELECT throws_ok(
  $$UPDATE public.context_index_outbox SET content_hash = repeat('a', 64) WHERE canonical_record_id = 'e4000000-0000-4000-8000-000000000001'$$,
  '55000', 'context_outbox_event_identity_is_immutable', 'outbox event identity cannot be rewritten'
);
SELECT throws_ok(
  $$UPDATE public.context_index_events SET safe_error_code = 'rewritten' WHERE id = (SELECT min(id) FROM public.context_index_events)$$,
  '55000', 'context_index_event_is_append_only', 'operational events are append-only'
);
SELECT throws_ok(
  $$INSERT INTO public.context_index_events(company_id, provider, event_type, safe_error_code)
    VALUES ('e2000000-0000-4000-8000-000000000001', 'supermemory', 'claim_blocked', 'raw stack trace: secret')$$,
  '23514', NULL, 'unbounded raw errors cannot enter operational events'
);

SELECT * FROM finish();
ROLLBACK;
