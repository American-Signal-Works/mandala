BEGIN;
SELECT plan(46);

SELECT has_table('public', 'context_index_operation_audits', 'service operation audits exist');
SELECT has_function('public', 'accept_context_index_work_v1', ARRAY['text','uuid','text','timestamp with time zone'], 'provider acceptance RPC exists');
SELECT has_function('public', 'claim_context_index_processing_v1', ARRAY['text','integer','integer','timestamp with time zone'], 'processing claim RPC exists');
SELECT has_function('public', 'defer_context_index_processing_v1', ARRAY['text','uuid','text','timestamp with time zone'], 'processing defer RPC exists');
SELECT has_function('public', 'configure_context_index_operations_v1', ARRAY['uuid','text','boolean','integer','integer','integer','bigint','text','timestamp with time zone'], 'audited operations RPC exists');
SELECT has_function('public', 'record_context_provider_health_v1', ARRAY['text','text','timestamp with time zone'], 'provider health evidence RPC exists');
SELECT has_function('public', 'reserve_context_provider_health_v1', ARRAY['timestamp with time zone'], 'provider health reservation RPC exists');
SELECT is(has_function_privilege('anon', 'public.accept_context_index_work_v1(text,uuid,text,timestamp with time zone)', 'EXECUTE'), false, 'anonymous cannot accept work');
SELECT is(has_function_privilege('authenticated', 'public.configure_context_index_operations_v1(uuid,text,boolean,integer,integer,integer,bigint,text,timestamp with time zone)', 'EXECUTE'), false, 'members cannot activate the worker');
SELECT is(has_function_privilege('service_role', 'public.configure_context_index_operations_v1(uuid,text,boolean,integer,integer,integer,bigint,text,timestamp with time zone)', 'EXECUTE'), true, 'service role may call checked operations RPC');
SELECT is(has_function_privilege('authenticated', 'public.record_context_provider_health_v1(text,text,timestamp with time zone)', 'EXECUTE'), false, 'members cannot forge provider health');
SELECT is(has_function_privilege('service_role', 'public.record_context_provider_health_v1(text,text,timestamp with time zone)', 'EXECUTE'), true, 'service role may persist bounded provider health');
SELECT is(has_function_privilege('authenticated', 'public.reserve_context_provider_health_v1(timestamp with time zone)', 'EXECUTE'), false, 'members cannot reserve provider traffic');
SELECT is(has_function_privilege('service_role', 'public.reserve_context_provider_health_v1(timestamp with time zone)', 'EXECUTE'), true, 'service role may reserve provider traffic');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'f1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'provider-sync-owner@example.test', '', now(), '{}', '{}', now(), now()
);
INSERT INTO public.companies(id, name, created_by)
VALUES ('f2000000-0000-4000-8000-000000000001', 'Provider Sync Tenant', 'f1000000-0000-4000-8000-000000000001');
INSERT INTO public.company_memberships(company_id, user_id, role, status)
VALUES ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'owner', 'active');
INSERT INTO public.external_sources(id, company_id, source_key, kind, name)
VALUES ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'curated', 'service', 'Curated aliases');

SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT public.set_context_workspace_configuration_v1(
  'f2000000-0000-4000-8000-000000000001', 1, 'supermemory', true,
  'not_ready', 'Prepare the provider-sync database test.'
);
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000001', 'curated', 'vendor_alias',
  0, true, ARRAY['/alias','/canonical'], 4096, 'internal', 30, 1,
  'Bound the provider-sync database test.'
);
INSERT INTO public.external_records(
  id, company_id, source_id, record_type, external_id, payload, pulled_at
) VALUES (
  'f4000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000001',
  'vendor_alias', 'alias-1', '{"alias":"ACME","canonical":"Acme Supply","secret":"excluded"}',
  '2026-07-18 04:00:00+00'
);

SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT throws_ok(
  $$SELECT public.configure_context_index_operations_v1(
    'f2000000-0000-4000-8000-000000000001', 'ready', true,
    1, 4, 10, 10000, 'Must not activate without a fresh provider probe.',
    '2026-07-18 04:01:00+00'
  )$$,
  '55000', 'context_provider_health_required', 'activation requires fresh live provider health'
);
SELECT lives_ok(
  $$SELECT public.reserve_context_provider_health_v1(
    '2026-07-18 04:00:58+00'
  )$$,
  'health traffic is reserved before the external probe'
);
SELECT lives_ok(
  $$SELECT public.record_context_provider_health_v1(
    'healthy', 'provider_ready', '2026-07-18 04:00:59+00'
  )$$,
  'service health probe is persisted before activation'
);
SELECT lives_ok(
  $$SELECT public.configure_context_index_operations_v1(
    'f2000000-0000-4000-8000-000000000001', 'ready', true,
    100000, 4, 10, 10000, 'Allow a policy-governed full-corpus provider sync.',
    '2026-07-18 04:01:00+00'
  )$$,
  'checked service operation supports a bounded full-corpus admission ceiling'
);
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('provider-worker', 1, 60, '2026-07-18 04:01:01+00')->'claims'), 1, 'dispatch claims one bounded record');
SELECT ok((SELECT dispatch_started_at IS NOT NULL FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'), 'dispatch start is durable before the provider call');
SELECT throws_ok(
  $$SELECT public.accept_context_index_work_v1(
    'wrong-worker',
    (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'),
    'provider-doc-1', '2026-07-18 04:01:02+00'
  )$$,
  '40001', 'context_index_lease_not_owned_or_expired', 'another worker cannot accept the lease'
);
SELECT is(
  public.accept_context_index_work_v1(
    'provider-worker',
    (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'),
    'provider-doc-1', '2026-07-18 04:01:02+00'
  )->>'status',
  'awaiting_provider', 'queued provider response persists as awaiting work'
);
SELECT is((SELECT delivery_state FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'), 'awaiting_provider', 'accepted work releases its dispatch lease');
SELECT is((SELECT status FROM public.context_index_ledger WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'), 'processing', 'ledger exposes provider processing truthfully');
SELECT ok(
  (WITH result AS (
    SELECT public.claim_context_index_processing_v1('provider-worker', 1, 60, '2026-07-18 04:01:03+00') AS value
  ) SELECT jsonb_array_length(value->'claims') = 1 AND NOT (value->'claims'->0 ? 'canonicalPayload') FROM result),
  'later heartbeat claims one read-only poll without canonical payload'
);
SELECT is((SELECT delivery_state FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'), 'leased', 'processing claim owns a separate lease');
SELECT is(
  public.defer_context_index_processing_v1(
    'provider-worker',
    (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'),
    'processing', '2026-07-18 04:01:04+00'
  )->>'status',
  'awaiting_provider', 'processing status schedules only another read-only poll'
);
SELECT is(jsonb_array_length(public.claim_context_index_processing_v1('provider-worker', 1, 60, '2026-07-18 04:01:20+00')->'claims'), 1, 'deferred provider work is pollable again');
SELECT is(
  public.complete_context_index_work_v1(
    'provider-worker',
    (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'),
    '{"providerDocumentId":"provider-doc-1","estimatedCostMicrounits":0}',
    '2026-07-18 04:01:21+00'
  )->>'status',
  'completed', 'done status uses the existing completion fence'
);
SELECT is((SELECT status FROM public.context_index_ledger WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'), 'indexed', 'provider done becomes indexed exactly once');
SELECT is((SELECT count(*)::integer FROM public.context_index_events WHERE event_type = 'provider_accepted'), 1, 'provider acceptance has append-only evidence');
SELECT is((SELECT count(*)::integer FROM public.context_index_operation_audits WHERE company_id = 'f2000000-0000-4000-8000-000000000001'), 1, 'canary activation is audited');
SELECT throws_ok(
  $$UPDATE public.context_workspace_settings
    SET provider = 'off', readiness = 'disabled'
    WHERE company_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '55000', 'context_index_drain_required', 'provider Off is blocked until indexed copies are deleted'
);
DELETE FROM public.external_records
WHERE id = 'f4000000-0000-4000-8000-000000000001';
UPDATE public.context_index_operation_controls
SET daily_operation_cap = 1, daily_cost_cap_microunits = 1
WHERE company_id = 'f2000000-0000-4000-8000-000000000001';
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('provider-worker', 1, 60, '2026-07-18 04:01:30+00')->'claims'), 0, 'spent ingestion allowance cannot claim cleanup through the normal path');
SELECT is(jsonb_array_length(public.claim_context_index_cleanup_v1('provider-worker', 1, 60, '2026-07-18 04:01:30+00')->'claims'), 0, 'cleanup respects the shared per-minute provider limit');
SELECT is(jsonb_array_length(public.claim_context_index_cleanup_v1('provider-worker', 1, 60, '2026-07-18 04:02:21+00')->'claims'), 1, 'cleanup bypasses exhausted spend allowance after request capacity resets');
SELECT is(
  public.complete_context_index_work_v1(
    'provider-worker',
    (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001' AND operation = 'delete'),
    '{"estimatedCostMicrounits":0}', '2026-07-18 04:02:22+00'
  )->>'deletionConfirmed',
  'true', 'cleanup confirmation drains the provider copy'
);

INSERT INTO public.external_records(
  id, company_id, source_id, record_type, external_id, payload, pulled_at
) VALUES (
  'f4000000-0000-4000-8000-000000000002',
  'f2000000-0000-4000-8000-000000000001',
  'f3000000-0000-4000-8000-000000000001',
  'vendor_alias', 'alias-2', '{"alias":"BETA","canonical":"Beta Supply"}',
  '2026-07-18 04:00:00+00'
);
UPDATE public.context_index_operation_controls
SET canary_record_limit = 2, daily_operation_cap = 10,
    daily_cost_cap_microunits = 10000
WHERE company_id = 'f2000000-0000-4000-8000-000000000001';
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('crashing-worker', 1, 60, '2026-07-18 04:03:22+00')->'claims'), 1, 'second dispatch can be claimed after the shared request window resets');
SELECT public.prepare_context_index_work_v1('2026-07-18 04:04:23+00', 10);
SELECT is((SELECT delivery_state FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000002'), 'needs_reconciliation', 'expired started dispatch is never blindly replayed');
SELECT is((SELECT safe_error_code FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000002'), 'dispatch_outcome_unknown', 'crash recovery records a safe bounded reason');
SELECT is((SELECT status FROM public.context_index_ledger WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000002'), 'reconcile_required', 'crash recovery keeps ledger state consistent');
SELECT is((SELECT event_type FROM public.context_index_events WHERE outbox_id = (SELECT id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000002') ORDER BY id DESC LIMIT 1), 'reconciliation_required', 'crash recovery records a consistent event');
SELECT throws_ok(
  $$UPDATE public.context_workspace_settings
    SET provider = 'off', readiness = 'disabled'
    WHERE company_id = 'f2000000-0000-4000-8000-000000000001'$$,
  '55000', 'context_index_drain_required', 'unknown provider dispatch outcomes also block provider Off'
);
SELECT is(
  (public.confirm_context_provider_batch_outcomes_v1(
    'f2000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'customId', (
        SELECT stable_custom_id
        FROM public.context_index_outbox
        WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000002'
      ),
      'providerDocumentId', 'provider-reconciled-2',
      'status', 'done'
    )),
    '2026-07-18 04:04:24+00'
  )->>'settledCount')::integer,
  1,
  'completed provider inventory evidence settles an outcome-unknown write'
);
SELECT is(
  (SELECT delivery_state FROM public.context_index_outbox
   WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000002'),
  'completed',
  'provider-confirmed reconciliation completes the durable outbox row'
);
SELECT is(
  (SELECT status FROM public.context_index_ledger
   WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000002'),
  'indexed',
  'provider-confirmed reconciliation restores indexed ledger state'
);

SELECT * FROM finish();
ROLLBACK;
