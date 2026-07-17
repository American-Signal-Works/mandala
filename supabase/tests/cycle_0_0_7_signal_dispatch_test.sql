BEGIN;
SELECT plan(32);

SELECT ok((
  SELECT bool_and(relrowsecurity)
  FROM pg_class
  WHERE oid = ANY(ARRAY[
    'public.agent_signal_change_windows'::REGCLASS,
    'public.agent_signal_dispatches'::REGCLASS,
    'public.agent_signal_dispatch_events'::REGCLASS
  ])
), 'all signal dispatch tables enable RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.agent_signal_change_windows','INSERT'),
  'authenticated clients cannot forge connector change windows');
SELECT ok(NOT has_table_privilege('authenticated','public.agent_signal_dispatches','INSERT'),
  'authenticated clients cannot enqueue signal work');
SELECT ok(NOT has_table_privilege('authenticated','public.agent_signal_dispatch_events','INSERT'),
  'authenticated clients cannot forge signal history');
SELECT ok(NOT has_function_privilege(
  'authenticated',
  'workflow_private.prepare_agent_signal_dispatches(timestamp with time zone,integer,integer)',
  'EXECUTE'
), 'authenticated clients cannot run the heartbeat');
SELECT ok(NOT has_function_privilege(
  'authenticated',
  'workflow_private.claim_agent_signal_dispatches(text,integer,integer,timestamp with time zone)',
  'EXECUTE'
), 'authenticated clients cannot claim signal work');
SELECT ok(NOT has_function_privilege(
  'authenticated',
  'workflow_private.complete_agent_signal_dispatch(text,uuid,text,jsonb)',
  'EXECUTE'
), 'authenticated clients cannot complete signal work');
SELECT ok(NOT has_function_privilege(
  'authenticated',
  'workflow_private.fail_agent_signal_dispatch(text,uuid,boolean,text)',
  'EXECUTE'
), 'authenticated clients cannot fail signal work');
SELECT ok(has_function_privilege(
  'service_role',
  'workflow_private.prepare_agent_signal_dispatches(timestamp with time zone,integer,integer)',
  'EXECUTE'
), 'service workers can prepare signal work');
SELECT is((
  SELECT count(*)::INTEGER FROM cron.job
  WHERE jobname = 'prepare-agent-signal-dispatches'
), 1, 'one signal heartbeat cron job is installed');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('d1000000-0000-4000-8000-000000000001','authenticated','authenticated','signal-owner@example.test','',now(),'{}','{}',now(),now()),
  ('d1000000-0000-4000-8000-000000000002','authenticated','authenticated','signal-other@example.test','',now(),'{}','{}',now(),now());

INSERT INTO public.companies(id,name,created_by) VALUES
  ('d2000000-0000-4000-8000-000000000001','Signal Company','d1000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000002','Other Signal Company','d1000000-0000-4000-8000-000000000002');
INSERT INTO public.company_memberships(company_id,user_id,role) VALUES
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','owner'),
  ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002','owner');

INSERT INTO public.agent_workflows(
  id,company_id,workflow_key,workflow_type,name,version,status,spec,
  compile_result,created_by,updated_by
) VALUES (
  'd3000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'signal_dispatch_test','signal_test','Signal dispatch test','1.0.0','active',
  '{
    "workflow": {
      "id": "signal-dispatch-test",
      "name": "Signal dispatch test",
      "version": "1.0.0",
      "default_mode": "shadow",
      "triggers": [
        {
          "id": "inventory-change",
          "kind": "webhook",
          "description": "Look for changed inventory positions.",
          "source_kinds": ["inventory_platform"],
          "record_types": ["inventory_position"],
          "changes": ["insert", "update"],
          "reconcile_every_minutes": 60
        },
        {
          "id": "quarter-hour",
          "kind": "schedule",
          "description": "Run a bounded interval check.",
          "every_minutes": 15
        }
      ]
    }
  }'::JSONB,
  '{"ok":true}'::JSONB,
  'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.workflow_binding_snapshots(
  id,company_id,workflow_id,manifest_hash,grant_digest,created_by
) VALUES (
  'd3100000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  repeat('8',64),repeat('9',64),
  'd1000000-0000-4000-8000-000000000001'
);

-- The activation is inserted before the controlled runtime state so the
-- existing promotion-checkpoint guard continues to own user-facing activation.
INSERT INTO public.workflow_activations(
  company_id,workflow_key,workflow_id,binding_snapshot_id,activated_by
) VALUES (
  'd2000000-0000-4000-8000-000000000001',
  'signal_dispatch_test',
  'd3000000-0000-4000-8000-000000000001',
  'd3100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.agent_runtime_states(
  id,company_id,workflow_id,lifecycle_state,state_version,
  readiness_status,readiness_issues,readiness_hash,readiness_checked_at,
  binding_snapshot_id,updated_by
) VALUES (
  'd3200000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'd3000000-0000-4000-8000-000000000001',
  'active',3,'ready','[]'::JSONB,repeat('a',64),now(),
  'd3100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.external_sources(
  id,company_id,source_key,kind,name,sync_status,last_synced_at
) VALUES (
  'd4000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'inventory-main','inventory_platform','Inventory main','idle',now()
);

-- A 250-row sync becomes one bounded window with a 100-id sample, rather
-- than 250 queue jobs or 250 payload copies.
INSERT INTO public.external_records(
  company_id,source_id,record_type,external_id,payload
)
SELECT
  'd2000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'inventory_position',
  'inventory-' || value,
  jsonb_build_object('sku','SKU-' || value,'available',value)
FROM generate_series(1,250) value;
INSERT INTO public.external_records(
  company_id,source_id,record_type,external_id,payload
) VALUES (
  'd2000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000001',
  'vendor','vendor-1','{"name":"Vendor one"}'::JSONB
);

SELECT is((
  SELECT count(*)::INTEGER
  FROM public.agent_signal_change_windows
  WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
), 2, 'one transaction is coalesced by source and record type');
SELECT is((
  SELECT change_count
  FROM public.agent_signal_change_windows
  WHERE record_type = 'inventory_position'
), 250, 'the bulk window retains the exact change count');
SELECT is((
  SELECT cardinality(sample_record_ids)
  FROM public.agent_signal_change_windows
  WHERE record_type = 'inventory_position'
), 100, 'the bulk window caps sampled record identifiers');
SELECT is((
  SELECT sample_truncated
  FROM public.agent_signal_change_windows
  WHERE record_type = 'inventory_position'
), true, 'the bulk window reports that its identifier sample was truncated');

SELECT set_config(
  'test.signal_prepare',
  workflow_private.prepare_agent_signal_dispatches(now(),100,100)::TEXT,
  true
);
SELECT is(
  (current_setting('test.signal_prepare')::JSONB ->> 'changeWindowsProcessed')::INTEGER,
  2,
  'the heartbeat processes each bounded change window'
);
SELECT is(
  (current_setting('test.signal_prepare')::JSONB ->> 'changeDispatchesEnqueued')::INTEGER,
  1,
  'only matching record types enqueue change work'
);
SELECT is(
  (current_setting('test.signal_prepare')::JSONB ->> 'scheduleDispatchesEnqueued')::INTEGER,
  1,
  'the active interval trigger enqueues one scheduled dispatch'
);
SELECT is(
  (current_setting('test.signal_prepare')::JSONB ->> 'reconciliationDispatchesEnqueued')::INTEGER,
  1,
  'the active change trigger also enqueues one reconciliation dispatch'
);
SELECT is((
  SELECT count(*)::INTEGER
  FROM public.agent_signal_dispatches
  WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
), 3, 'change, schedule, and reconciliation signals share one durable queue');

SELECT set_config(
  'test.signal_prepare_again',
  workflow_private.prepare_agent_signal_dispatches(now(),100,100)::TEXT,
  true
);
SELECT is(
  (
    (current_setting('test.signal_prepare_again')::JSONB ->> 'changeDispatchesEnqueued')::INTEGER
    + (current_setting('test.signal_prepare_again')::JSONB ->> 'scheduleDispatchesEnqueued')::INTEGER
    + (current_setting('test.signal_prepare_again')::JSONB ->> 'reconciliationDispatchesEnqueued')::INTEGER
  ),
  0,
  'rerunning the same heartbeat window is idempotent'
);

CREATE TEMP TABLE signal_test_claims AS
SELECT * FROM workflow_private.claim_agent_signal_dispatches(
  'signal-worker-1',10,120,now()
);
SELECT is((SELECT count(*)::INTEGER FROM signal_test_claims), 3,
  'one worker atomically claims all due signal work');
SELECT is((
  SELECT count(*)::INTEGER
  FROM workflow_private.claim_agent_signal_dispatches('signal-worker-2',10,120,now())
), 0, 'a competing worker cannot claim active leases');

SELECT is(
  workflow_private.complete_agent_signal_dispatch(
    'signal-worker-1',
    (SELECT "leaseId" FROM signal_test_claims WHERE "dispatch" ->> 'signalKind' = 'record_change'),
    'completed',
    '{"candidateCount":2}'::JSONB
  ) ->> 'status',
  'completed',
  'a worker completes a leased dispatch with bounded output'
);
SELECT is((
  SELECT status
  FROM public.agent_signal_dispatches
  WHERE signal_kind = 'record_change'
    AND company_id = 'd2000000-0000-4000-8000-000000000001'
), 'completed', 'completed signal state is durable');
SELECT is(
  workflow_private.fail_agent_signal_dispatch(
    'signal-worker-1',
    (SELECT "leaseId" FROM signal_test_claims WHERE "dispatch" ->> 'signalKind' = 'schedule'),
    true,
    'provider_unavailable'
  ) ->> 'status',
  'pending',
  'retryable failures return work to the queue'
);
SELECT ok((
  SELECT status = 'pending' AND lease_id IS NULL AND attempts = 1
  FROM public.agent_signal_dispatches
  WHERE signal_kind = 'schedule'
    AND company_id = 'd2000000-0000-4000-8000-000000000001'
), 'retry scheduling clears the lease and retains the attempt count');
SELECT is(
  workflow_private.fail_agent_signal_dispatch(
    'signal-worker-1',
    (SELECT "leaseId" FROM signal_test_claims WHERE "dispatch" ->> 'signalKind' = 'reconciliation'),
    false,
    'invalid_connector_contract'
  ) ->> 'status',
  'dead_letter',
  'terminal failures move to the dead-letter state'
);
SELECT ok((
  SELECT status = 'dead_letter' AND completed_at IS NOT NULL
  FROM public.agent_signal_dispatches
  WHERE signal_kind = 'reconciliation'
    AND company_id = 'd2000000-0000-4000-8000-000000000001'
), 'dead-letter signal state is terminal and timestamped');
SELECT is((
  SELECT count(*)::INTEGER
  FROM public.agent_signal_dispatch_events
  WHERE company_id = 'd2000000-0000-4000-8000-000000000001'
    AND event_type IN ('completed','retry_scheduled','dead_letter')
), 3, 'worker outcomes are appended to signal history');
SELECT throws_ok(
  $$UPDATE public.agent_signal_dispatch_events SET reason='changed' WHERE company_id='d2000000-0000-4000-8000-000000000001'$$,
  '55000',
  'agent_signal_dispatch_history_immutable',
  'signal history cannot be rewritten'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT is((SELECT count(*)::INTEGER FROM public.agent_signal_dispatches), 0,
  'RLS hides another company signal queue');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is((SELECT count(*)::INTEGER FROM public.agent_signal_dispatches), 3,
  'company members can inspect their own signal queue');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
