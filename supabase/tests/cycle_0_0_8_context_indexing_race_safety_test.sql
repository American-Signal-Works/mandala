BEGIN;
SELECT plan(40);

CREATE TEMP TABLE context_reconcile_test_results (
  payload JSONB NOT NULL
) ON COMMIT DROP;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('f1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'race-owner-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('f1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'race-owner-b@example.test', '', now(), '{}', '{}', now(), now());
INSERT INTO public.companies(id, name, created_by) VALUES
  ('f2000000-0000-4000-8000-000000000001', 'Race Tenant A', 'f1000000-0000-4000-8000-000000000001'),
  ('f2000000-0000-4000-8000-000000000002', 'Race Tenant B', 'f1000000-0000-4000-8000-000000000002');
INSERT INTO public.company_memberships(company_id, user_id, role, status) VALUES
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'owner', 'active');
INSERT INTO public.external_sources(id, company_id, source_key, kind, name) VALUES
  ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'helpdesk', 'service', 'Race Helpdesk A'),
  ('f3000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'service', 'Race Helpdesk B');

SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000001', 'helpdesk', 'support_ticket',
  0, true, ARRAY['/ticket_id','/summary'], 65536, 'internal', 30, 1,
  'Race safety policy A.'
);
UPDATE public.context_workspace_settings
SET provider = 'supermemory', readiness = 'ready'
WHERE company_id = 'f2000000-0000-4000-8000-000000000001';
UPDATE public.context_index_operation_controls
SET worker_enabled = true, canary_record_limit = 1,
    requests_per_minute = 100, daily_operation_cap = 100,
    daily_cost_cap_microunits = 100000, estimated_operation_cost_microunits = 1000,
    max_attempts = 5
WHERE company_id = 'f2000000-0000-4000-8000-000000000001';

-- Retry and deletion for an admitted record remain claimable at canary saturation.
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload)
VALUES ('f4000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'support_ticket', 'ORPHAN-1', '{"ticket_id":"ORPHAN-1","summary":"leased add"}');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('race-worker', 1, 60, now())->'claims'), 1, 'first canary record is admitted');
SELECT is(
  public.fail_context_index_work_v1(
    'race-worker', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'),
    'transient', 'provider_timeout', now() + interval '1 second'
  )->>'status',
  'retry', 'admitted record schedules a retry'
);
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('race-worker', 1, 60, now() + interval '31 seconds')->'claims'), 1, 'retry remains claimable when canary is exactly full');
DELETE FROM public.external_records WHERE id = 'f4000000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::integer FROM public.context_index_tombstones WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'), 0, 'delete during leased first add waits for accepted provider identity');
SELECT is(
  public.complete_context_index_work_v1(
    'race-worker', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001' AND delivery_state = 'leased'),
    '{"providerDocumentId":"provider-orphan-fence","estimatedCostMicrounits":0}', now() + interval '32 seconds'
  )->>'status',
  'completed', 'leased add completion is fenced against canonical deletion'
);
SELECT is((SELECT provider_document_id FROM public.context_index_ledger WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001'), 'provider-orphan-fence', 'completion fence retains the accepted provider document id');
SELECT is((SELECT count(*)::integer FROM public.context_index_tombstones WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001' AND confirmed_at IS NULL), 1, 'completion fence atomically creates the missing tombstone');
SELECT is((public.claim_context_index_work_v1('race-worker', 1, 60, now() + interval '2 minutes')->'claims'->0->>'operation'), 'delete', 'delete remains claimable for the admitted record at canary saturation');
SELECT is(
  public.complete_context_index_work_v1(
    'race-worker', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000001' AND operation = 'delete'),
    '{"estimatedCostMicrounits":0}', now() + interval '121 seconds'
  )->>'deletionConfirmed',
  'true', 'orphan cleanup confirms provider deletion'
);

-- Cumulative reservation admits only the number of operations the batch can afford.
UPDATE public.context_index_operation_controls
SET canary_record_limit = 10, daily_cost_cap_microunits = 1500
WHERE company_id = 'f2000000-0000-4000-8000-000000000001';
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload) VALUES
  ('f4000000-0000-4000-8000-000000000011', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'support_ticket', 'BATCH-1', '{"ticket_id":"BATCH-1","summary":"one"}'),
  ('f4000000-0000-4000-8000-000000000012', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'support_ticket', 'BATCH-2', '{"ticket_id":"BATCH-2","summary":"two"}'),
  ('f4000000-0000-4000-8000-000000000013', 'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001', 'support_ticket', 'BATCH-3', '{"ticket_id":"BATCH-3","summary":"three"}');
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('batch-worker', 10, 60, now() + interval '1 day')->'claims'), 1, 'batch claim cannot reserve beyond the cumulative company spend cap');
SELECT is((SELECT sum(reserved_cost_microunits)::bigint FROM public.context_index_outbox WHERE lease_owner = 'batch-worker'), 1000::bigint, 'batch reservation stays within the 1500 microunit cap');
SELECT ok(
  pg_get_functiondef('public.claim_context_index_work_v1(text,integer,integer,timestamp with time zone)'::regprocedure)
    ~ 'context_index_operation_controls[[:space:]]+controls.*FOR UPDATE',
  'claim serializes each enabled company control row before gate accounting'
);
UPDATE public.context_index_operation_controls
SET worker_enabled = false
WHERE company_id = 'f2000000-0000-4000-8000-000000000001';

-- Tenant B exercises update fencing, policy lifecycle, and timed retention.
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'support_ticket',
  0, true, ARRAY['/ticket_id','/summary'], 65536, 'internal', 30, 1,
  'Race safety policy B.'
);
UPDATE public.context_workspace_settings
SET provider = 'supermemory', readiness = 'ready'
WHERE company_id = 'f2000000-0000-4000-8000-000000000002';
UPDATE public.context_index_operation_controls
SET worker_enabled = true, canary_record_limit = 10,
    requests_per_minute = 100, daily_operation_cap = 100,
    daily_cost_cap_microunits = 100000, estimated_operation_cost_microunits = 1000
WHERE company_id = 'f2000000-0000-4000-8000-000000000002';
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload)
VALUES ('f4000000-0000-4000-8000-000000000021', 'f2000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000002', 'support_ticket', 'UPDATE-1', '{"ticket_id":"UPDATE-1","summary":"old"}');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('update-worker', 1, 60, now())->'claims'), 1, 'old canonical version is leased');
UPDATE public.external_records
SET payload = '{"ticket_id":"UPDATE-1","summary":"new"}'
WHERE id = 'f4000000-0000-4000-8000-000000000021';
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021' AND delivery_state = 'pending' AND operation = 'add'), 1, 'concurrent update initially queues without an accepted provider id');
SELECT is(
  public.complete_context_index_work_v1(
    'update-worker', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021' AND delivery_state = 'leased'),
    '{"providerDocumentId":"provider-update-fence","estimatedCostMicrounits":0}', now() + interval '1 second'
  )->>'status',
  'completed', 'old leased add completion fences against the concurrent update'
);
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021' AND delivery_state = 'pending' AND operation = 'replace'), 1, 'completion fence converts current work to an exact replacement');
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021' AND delivery_state = 'superseded' AND operation = 'add'), 1, 'stale concurrent add is terminally superseded');
SELECT is((public.claim_context_index_work_v1('update-worker', 1, 60, now() + interval '2 minutes')->'claims'->0->>'operation'), 'replace', 'current replacement is claimable');
SELECT is(
  public.complete_context_index_work_v1(
    'update-worker', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021' AND delivery_state = 'leased'),
    '{"providerDocumentId":"provider-update-fence","estimatedCostMicrounits":0}', now() + interval '121 seconds'
  )->>'status',
  'completed', 'current replacement reaches indexed state'
);

SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'support_ticket',
  1, true, ARRAY['/ticket_id'], 65536, 'internal', 30, 2,
  'Narrow the indexed field scope.'
);
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021' AND delivery_state = 'pending' AND operation = 'replace' AND policy_version = 2), 1, 'field-scope change schedules an exact replacement');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is((public.claim_context_index_work_v1('update-worker', 1, 60, now() + interval '3 minutes')->'claims'->0->>'operation'), 'replace', 'field-scope replacement is claimable');
SELECT is(
  public.complete_context_index_work_v1(
    'update-worker', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021' AND delivery_state = 'leased'),
    '{"providerDocumentId":"provider-update-fence","estimatedCostMicrounits":0}', now() + interval '181 seconds'
  )->>'status',
  'completed', 'field-scope replacement is durably indexed'
);
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'support_ticket',
  2, false, ARRAY[]::text[], 65536, 'internal', 30, 2,
  'Disable indexing and remove existing provider content.'
);
SELECT is((SELECT count(*)::integer FROM public.context_index_tombstones WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021' AND confirmed_at IS NULL), 1, 'policy disable schedules deletion while canonical row remains');
SELECT is((SELECT deletion_reason FROM public.context_index_tombstones WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021'), 'policy_disabled', 'policy lifecycle records a bounded deletion reason');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
WITH claimed AS (
  SELECT public.claim_context_index_work_v1(
    'update-worker', 1, 60, now() + interval '4 minutes'
  )->'claims'->0 AS claim
)
SELECT ok(
  claim->>'operation' = 'delete'
    AND claim->'sourceId' = 'null'::jsonb
    AND claim->'externalId' = 'null'::jsonb
    AND claim->'observedAt' = 'null'::jsonb
    AND claim->'projectedContent' = 'null'::jsonb
    AND claim->'canonicalPayload' = 'null'::jsonb,
  'policy cleanup delete is claimable with canonical row present and contains no canonical projection data'
)
FROM claimed;
SELECT is(
  public.complete_context_index_work_v1(
    'update-worker', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000021' AND operation = 'delete'),
    '{"estimatedCostMicrounits":0}', now() + interval '241 seconds'
  )->>'deletionConfirmed',
  'true', 'policy cleanup deletion is confirmed'
);

-- Re-enable with short retention, index a fresh record, then age it by reconciliation time.
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'support_ticket',
  3, true, ARRAY['/ticket_id','/summary'], 65536, 'internal', 1, 3,
  'Re-enable with one-day retention.'
);
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload, pulled_at)
VALUES ('f4000000-0000-4000-8000-000000000022', 'f2000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000002', 'support_ticket', 'RETENTION-1', '{"ticket_id":"RETENTION-1","summary":"fresh"}', now());
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is(jsonb_array_length(public.claim_context_index_work_v1('retention-worker', 1, 60, now() + interval '6 minutes')->'claims'), 1, 'fresh retained record is claimable');
SELECT is(
  public.complete_context_index_work_v1(
    'retention-worker', (SELECT lease_id FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000022'),
    '{"providerDocumentId":"provider-retention","estimatedCostMicrounits":0}', now() + interval '361 seconds'
  )->>'status',
  'completed', 'fresh retained record is indexed'
);
SELECT public.reconcile_context_index_work_v1(
  'f2000000-0000-4000-8000-000000000002', 'reconciliation', 0,
  now() + interval '2 days'
);
SELECT is((SELECT count(*)::integer FROM public.context_index_tombstones WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000022' AND confirmed_at IS NULL), 1, 'reconciliation schedules timed retention expiry');
SELECT is((SELECT deletion_reason FROM public.context_index_tombstones WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000022'), 'retention_expired', 'retention expiry uses bounded lifecycle evidence');

-- Expired canonical records neither enter the frozen snapshot nor consume a bounded queue slot.
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'support_ticket',
  4, false, ARRAY[]::text[], 65536, 'internal', 1, 3,
  'Disable support scope before isolated retention reconciliation.'
);
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload, pulled_at) VALUES
  ('f4000000-0000-4000-8000-000000000005', 'f2000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000002', 'reconcile_ticket', 'RECONCILE-EXPIRED', '{"summary":"expired"}', now() - interval '2 days'),
  ('f4000000-0000-4000-8000-000000000006', 'f2000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000002', 'reconcile_ticket', 'RECONCILE-FRESH', '{"summary":"fresh"}', now());
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'reconcile_ticket',
  0, true, ARRAY['/summary'], 65536, 'internal', 1, 1,
  'Isolated one-day reconciliation retention policy.'
);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
INSERT INTO context_reconcile_test_results(payload)
SELECT public.reconcile_context_index_work_v1(
  'f2000000-0000-4000-8000-000000000002', 'reconciliation', 1, now()
);
SELECT is((SELECT (payload->>'eligibleCount')::integer FROM context_reconcile_test_results), 1, 'expired record is excluded from the frozen eligible snapshot');
SELECT is((SELECT (payload->>'queuedCount')::integer FROM context_reconcile_test_results), 1, 'fresh record receives the single bounded reconciliation queue slot');
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000005'), 0, 'expired record is not queued even though it sorts first');
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000006' AND delivery_state = 'pending'), 1, 'fresh record is durably queued behind the expired record');

-- Oversized and stale pending work becomes visible terminal evidence.
SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'oversized_ticket',
  0, true, ARRAY['/summary'], 10, 'internal', 30, 1,
  'Tiny bound for invalid pending work test.'
);
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload)
VALUES ('f4000000-0000-4000-8000-000000000023', 'f2000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000002', 'oversized_ticket', 'OVERSIZED-1', '{"summary":"this projection is intentionally too large"}');
SELECT is((SELECT delivery_state FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000023'), 'pending', 'oversized work is durably visible before preparation');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT is((public.prepare_context_index_work_v1(now() + interval '10 minutes', 100)->>'deadLetteredCount')::integer, 1, 'prepare terminalizes permanently oversized work');
SELECT is((SELECT delivery_state FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000023'), 'dead_letter', 'oversized work cannot remain invisibly pending');
SELECT is((SELECT safe_error_code FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000023'), 'projection_too_large', 'invalid pending work records only a bounded safe error code');

SELECT set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"f1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'stale_ticket',
  0, true, ARRAY['/summary'], 65536, 'internal', 30, 1,
  'Initial stale-work policy.'
);
INSERT INTO public.external_records(id, company_id, source_id, record_type, external_id, payload)
VALUES ('f4000000-0000-4000-8000-000000000024', 'f2000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000002', 'stale_ticket', 'STALE-1', '{"summary":"stale"}');
SELECT public.publish_context_indexing_policy_v1(
  'f2000000-0000-4000-8000-000000000002', 'helpdesk', 'stale_ticket',
  1, true, ARRAY['/summary'], 65536, 'internal', 30, 2,
  'Advance stale-work projection.'
);
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000024' AND delivery_state = 'superseded'), 1, 'policy advance terminally supersedes stale pending identity');
SELECT is((SELECT count(*)::integer FROM public.context_index_outbox WHERE canonical_record_id = 'f4000000-0000-4000-8000-000000000024' AND delivery_state = 'pending' AND policy_version = 2), 1, 'policy advance durably enqueues current replacement identity');

SELECT * FROM finish();
ROLLBACK;
