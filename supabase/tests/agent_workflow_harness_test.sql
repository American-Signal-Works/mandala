BEGIN;
SELECT plan(38);

SELECT ok(
  (
    SELECT 'synthetic_agent_run' = ANY(allowed_scenario_ids)
    FROM public.workflow_fixture_adapters
    WHERE adapter_key = 'procurement_reorder_fixture_v1'
  ),
  'guarded procurement adapter allows the synthetic test-agent scenario'
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'approver-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'member-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'viewer-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'agent-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'outsider@example.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'owner-b@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by)
VALUES
  ('20000000-0000-0000-0000-000000000001', 'Fixture Company A', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'Fixture Company B', '10000000-0000-0000-0000-000000000007');

INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'owner'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'approver'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'member'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'viewer'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'agent'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000007', 'owner');

INSERT INTO public.agent_workflows (
  id, company_id, workflow_key, workflow_type, name, version, status, spec, created_by, updated_by
)
VALUES
  (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    'generic_mock_action_review',
    'generic_mock_action',
    'Generic Mock Action Review',
    '0.1.0',
    'active',
    '{"defaultMode":"mock","allowedActions":[{"actionType":"execute_mock_action","mode":"mock","requiresApproval":true}]}'::jsonb,
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '30000000-0000-0000-0000-000000000099',
    '20000000-0000-0000-0000-000000000002',
    'company_b_workflow',
    'generic_mock_action',
    'Company B Workflow',
    '0.1.0',
    'active',
    '{"defaultMode":"mock","allowedActions":[]}'::jsonb,
    '10000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000007'
  );

INSERT INTO public.company_approval_policies (
  company_id, workflow_type, action_type, minimum_role, require_human_approval, require_warning_acknowledgement
)
VALUES (
  '20000000-0000-0000-0000-000000000001',
  'generic_mock_action',
  'execute_mock_action',
  'approver',
  true,
  true
);

INSERT INTO public.workflow_runs (
  id, company_id, workflow_id, workflow_type, status, input,
  langgraph_thread_id, langgraph_checkpoint_id, langsmith_trace_id, started_by
)
VALUES
  (
    '31000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'generic_mock_action',
    'waiting_for_approval',
    '{}',
    'thread-1',
    'checkpoint-1',
    'trace-1',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '31000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'generic_mock_action',
    'waiting_for_approval',
    '{}',
    'thread-2',
    'checkpoint-2',
    'trace-2',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '31000000-0000-0000-0000-000000000099',
    '20000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000099',
    'generic_mock_action',
    'started',
    '{}',
    'thread-b',
    'checkpoint-b',
    'trace-b',
    '10000000-0000-0000-0000-000000000007'
  );

INSERT INTO public.workflow_events (
  id, company_id, workflow_run_id, workflow_id, event_key, event_type, origin,
  source_ref, payload, freshness_state, validation_status, validation_result
)
VALUES
  (
    '32000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'generic:event:1',
    'fixture_snapshot',
    'fixture',
    '{}', '{}', 'fresh', 'pass', '{"status":"pass"}'
  ),
  (
    '32000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'generic:event:2',
    'fixture_snapshot',
    'fixture',
    '{}', '{}', 'fresh', 'warn', '{"status":"warn"}'
  );

INSERT INTO public.workflow_items (
  id, company_id, workflow_run_id, workflow_event_id, workflow_id, item_key, item_type, title, status
)
VALUES
  (
    '33000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '32000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    'generic:item:1',
    'generic_action_review',
    'Review generic mock action',
    'active'
  ),
  (
    '33000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000002',
    '32000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    'generic:item:2',
    'generic_action_review',
    'Review warning-state mock action',
    'active'
  );

INSERT INTO public.workflow_context_packets (
  id, company_id, workflow_run_id, workflow_item_id, sources, facts, freshness_state
)
VALUES
  ('34000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', '[]', '{}', 'fresh'),
  ('34000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000002', '[]', '{}', 'fresh');

INSERT INTO public.workflow_recommendation_runs (
  id, company_id, workflow_run_id, workflow_item_id, context_packet_id, status,
  rationale_summary, warning_state, warnings, confidence, freshness_state, input, output
)
VALUES
  (
    '35000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    '33000000-0000-0000-0000-000000000001',
    '34000000-0000-0000-0000-000000000001',
    'ready_for_review', 'Ready for review.', 'pass', '[]', 0.900, 'fresh', '{}', '{}'
  ),
  (
    '35000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000002',
    '33000000-0000-0000-0000-000000000002',
    '34000000-0000-0000-0000-000000000002',
    'ready_for_review', 'Warning requires review.', 'warn', '["Review warning"]', 0.700, 'fresh', '{}', '{}'
  );

INSERT INTO public.workflow_evidence_snapshots (
  id, company_id, workflow_run_id, workflow_item_id, recommendation_run_id, source_refs, assumptions, warnings, evidence
)
VALUES
  ('36000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001', '[]', '[]', '[]', '[]'),
  ('36000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002', '33000000-0000-0000-0000-000000000002', '35000000-0000-0000-0000-000000000002', '[]', '[]', '["Review warning"]', '[]');

WITH draft_payloads(id, run_id, item_id, recommendation_id, evidence_id, payload) AS (
  VALUES
    (
      '37000000-0000-0000-0000-000000000001'::uuid,
      '31000000-0000-0000-0000-000000000001'::uuid,
      '33000000-0000-0000-0000-000000000001'::uuid,
      '35000000-0000-0000-0000-000000000001'::uuid,
      '36000000-0000-0000-0000-000000000001'::uuid,
      '{"vendor":"Fixture Vendor","mode":"mock","lines":[{"sku":"FIXTURE-1","quantity":10,"reason":"Baseline"}]}'::jsonb
    ),
    (
      '37000000-0000-0000-0000-000000000002'::uuid,
      '31000000-0000-0000-0000-000000000002'::uuid,
      '33000000-0000-0000-0000-000000000002'::uuid,
      '35000000-0000-0000-0000-000000000002'::uuid,
      '36000000-0000-0000-0000-000000000002'::uuid,
      '{"vendor":"Fixture Vendor","mode":"mock","lines":[{"sku":"FIXTURE-2","quantity":20,"reason":"Warning review"}]}'::jsonb
    )
)
INSERT INTO public.workflow_action_drafts (
  id, company_id, workflow_run_id, workflow_item_id, recommendation_run_id,
  evidence_snapshot_id, action_type, status, payload, payload_hash, edit_policy
)
SELECT
  id,
  '20000000-0000-0000-0000-000000000001',
  run_id,
  item_id,
  recommendation_id,
  evidence_id,
  'execute_mock_action',
  'pending_review',
  payload,
  encode(extensions.digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex'),
  jsonb_build_object(
    'editable', true,
    'requireReason', true,
    'immutablePaths', jsonb_build_array(jsonb_build_array('vendor'), jsonb_build_array('mode'), jsonb_build_array('lines', '0', 'sku')),
    'arrayLengthPaths', jsonb_build_array(jsonb_build_array('lines')),
    'positiveIntegerPaths', jsonb_build_array(jsonb_build_array('lines', '0', 'quantity')),
    'nonEmptyStringPaths', jsonb_build_array(jsonb_build_array('lines', '0', 'reason'))
  )
FROM draft_payloads;

SELECT is(
  (
    SELECT count(*)
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'companies', 'company_memberships', 'company_approval_policies', 'workflow_fixture_adapters', 'agent_workflows',
        'workflow_runs', 'workflow_events', 'workflow_items', 'workflow_context_packets',
        'workflow_recommendation_runs', 'workflow_evidence_snapshots', 'workflow_action_drafts',
        'workflow_decisions', 'workflow_execution_tokens', 'workflow_action_attempts', 'workflow_audit_events'
      )
      AND relation.relrowsecurity
  ),
  16::bigint,
  'RLS is enabled on every company and workflow table'
);
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_action_drafts', 'UPDATE'), 'authenticated cannot update drafts directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_action_attempts', 'INSERT'), 'authenticated cannot insert attempts directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_execution_tokens', 'SELECT'), 'execution token rows are not selectable');
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_fixture_adapters', 'INSERT'), 'authenticated cannot register fixture adapters');
SELECT ok(NOT has_function_privilege('anon', 'public.record_workflow_decision(uuid,uuid,text,text,boolean,jsonb)', 'EXECUTE'), 'anon cannot call decision RPC');
SELECT ok(has_function_privilege('authenticated', 'public.record_workflow_decision_controlled(uuid,uuid,text,text,text,text,boolean,jsonb)', 'EXECUTE'), 'authenticated may call controlled decision RPC');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000006', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.companies WHERE id = '20000000-0000-0000-0000-000000000001'), 0::bigint, 'non-member cannot read another company');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.companies WHERE id = '20000000-0000-0000-0000-000000000001'), 1::bigint, 'company owner can read their company');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.record_workflow_decision_controlled('20000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', 'approve', repeat('a', 64), 'api', NULL, false, NULL)$$,
  '42501', 'forbidden', 'viewer cannot approve'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.record_workflow_decision_controlled('20000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', 'approve', repeat('b', 64), 'api', NULL, false, NULL)$$,
  '42501', 'forbidden', 'agent membership cannot self-approve'
);
RESET ROLE;

CREATE TEMP TABLE approval_results (result jsonb) ON COMMIT DROP;
CREATE TEMP TABLE execution_results (result jsonb) ON COMMIT DROP;
GRANT SELECT, INSERT ON approval_results, execution_results TO authenticated;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO approval_results
    SELECT public.record_workflow_decision_controlled(
      '20000000-0000-0000-0000-000000000001',
      '37000000-0000-0000-0000-000000000001',
      'approve', repeat('c', 64), 'api', NULL, false, NULL
    )$$,
  'approver records an approval atomically'
);
RESET ROLE;

SELECT is((SELECT result #>> '{draft,status}' FROM approval_results LIMIT 1), 'approved', 'approval updates the draft');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO execution_results
    SELECT public.execute_mock_workflow_action_controlled(
      '20000000-0000-0000-0000-000000000001',
      '37000000-0000-0000-0000-000000000001',
      (SELECT (result #>> '{decision,id}')::uuid FROM approval_results LIMIT 1),
      (SELECT result #>> '{executionToken,rawToken}' FROM approval_results LIMIT 1),
      'api:00000000-0000-4000-8000-000000000001',
      '{"vendor":"Fixture Vendor","mode":"mock","lines":[{"sku":"FIXTURE-1","quantity":10,"reason":"Baseline"}]}'::jsonb,
      repeat('d', 64),
      'api'
    )$$,
  'approved mock action executes atomically'
);
RESET ROLE;

SELECT is((SELECT result ->> 'duplicate' FROM execution_results LIMIT 1), 'false', 'first execution is not a duplicate');
SELECT is((SELECT count(*) FROM public.workflow_action_attempts WHERE action_draft_id = '37000000-0000-0000-0000-000000000001'), 1::bigint, 'first execution creates one attempt');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO execution_results
    SELECT public.execute_mock_workflow_action_controlled(
      '20000000-0000-0000-0000-000000000001',
      '37000000-0000-0000-0000-000000000001',
      (SELECT (result #>> '{decision,id}')::uuid FROM approval_results LIMIT 1),
      (SELECT result #>> '{executionToken,rawToken}' FROM approval_results LIMIT 1),
      'api:00000000-0000-4000-8000-000000000001',
      '{"vendor":"Fixture Vendor","mode":"mock","lines":[{"sku":"FIXTURE-1","quantity":10,"reason":"Baseline"}]}'::jsonb,
      repeat('e', 64),
      'api'
    )$$,
  'same idempotent execution returns the existing result'
);
RESET ROLE;

SELECT is((SELECT result ->> 'duplicate' FROM execution_results ORDER BY ctid DESC LIMIT 1), 'true', 'idempotent retry is marked duplicate');
SELECT is((SELECT count(*) FROM public.workflow_action_attempts WHERE action_draft_id = '37000000-0000-0000-0000-000000000001'), 1::bigint, 'idempotent retry keeps one attempt');
SELECT is(
  (SELECT count(*) FROM public.workflow_audit_events WHERE event_type = 'mock_action_retry_suppressed'),
  1::bigint,
  'idempotent retry appends an inspectable audit event'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.record_workflow_execution_failure(uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated callers cannot author workflow execution failures'
);
SELECT ok(
  pg_get_functiondef('workflow_private.record_workflow_execution_failure(uuid,uuid,text,text)'::REGPROCEDURE)
    LIKE '%idempotencyKeyHash%',
  'private execution failure audit stores only an idempotency hash'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.execute_mock_workflow_action_controlled(
      '20000000-0000-0000-0000-000000000001',
      '37000000-0000-0000-0000-000000000001',
      (SELECT (result #>> '{decision,id}')::uuid FROM approval_results LIMIT 1),
      (SELECT result #>> '{executionToken,rawToken}' FROM approval_results LIMIT 1),
      'api:00000000-0000-4000-8000-000000000001',
      '{"vendor":"Fixture Vendor","mode":"mock","lines":[{"sku":"FIXTURE-1","quantity":99,"reason":"Changed"}]}'::jsonb,
      repeat('f', 64),
      'api'
    )$$,
  '22023', 'idempotency_key_reused', 'idempotency key cannot be reused for a different payload'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.record_workflow_decision_controlled('20000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000002', 'approve', repeat('1', 64), 'api', NULL, false, NULL)$$,
  '22023', 'warnings_not_acknowledged', 'warning-state approval requires acknowledgement'
);
SELECT throws_ok(
  $$SELECT public.record_workflow_decision_controlled(
      '20000000-0000-0000-0000-000000000001',
      '37000000-0000-0000-0000-000000000002',
      'edit',
      repeat('2', 64),
      'api',
      'Attempt identity change',
      true,
      '{"vendor":"Other Vendor","mode":"mock","lines":[{"sku":"FIXTURE-2","quantity":24,"reason":"Edited"}]}'::jsonb
    )$$,
  '22023', 'edited_payload_identity_changed', 'edit cannot change immutable action identity'
);
SELECT lives_ok(
  $$INSERT INTO approval_results
    SELECT public.record_workflow_decision_controlled(
      '20000000-0000-0000-0000-000000000001',
      '37000000-0000-0000-0000-000000000002',
      'edit',
      repeat('3', 64),
      'api',
      'Reviewed quantity adjustment',
      true,
      '{"vendor":"Fixture Vendor","mode":"mock","lines":[{"sku":"FIXTURE-2","quantity":24,"reason":"Edited"}]}'::jsonb
    )$$,
  'valid bounded edit succeeds'
);
RESET ROLE;

SELECT is((SELECT payload #>> '{lines,0,quantity}' FROM public.workflow_action_drafts WHERE id = '37000000-0000-0000-0000-000000000002'), '24', 'bounded edit stores approved quantity');

SELECT throws_ok(
  $$INSERT INTO public.workflow_events (
      id, company_id, workflow_run_id, workflow_id, event_key, event_type, origin,
      freshness_state, validation_status
    ) VALUES (
      '32000000-0000-0000-0000-000000000099',
      '20000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000099',
      '30000000-0000-0000-0000-000000000001',
      'cross-tenant-event', 'fixture_snapshot', 'fixture', 'fresh', 'pass'
    )$$,
  '23503',
  'insert or update on table "workflow_events" violates foreign key constraint "workflow_events_run_company_fkey"',
  'tenant-consistent foreign key rejects cross-company relationships'
);

CREATE TEMP TABLE fixture_payloads (payload jsonb) ON COMMIT DROP;
CREATE TEMP TABLE fixture_results (result jsonb) ON COMMIT DROP;
GRANT SELECT ON fixture_payloads TO authenticated;
GRANT SELECT, INSERT ON fixture_results TO authenticated;

INSERT INTO fixture_payloads VALUES (
  jsonb_build_object(
    'company_id', '20000000-0000-0000-0000-000000000001',
    'definition', jsonb_build_object(
      'id', '30000000-0000-0000-0000-000000000010',
      'company_id', '20000000-0000-0000-0000-000000000001',
      'workflow_key', 'procurement_reorder_review',
      'workflow_type', 'procurement_reorder',
      'name', 'Procurement Reorder Review',
      'version', '0.1.0',
      'status', 'draft',
      'spec', jsonb_build_object(
        'workflowKey', 'procurement_reorder_review',
        'workflowType', 'procurement_reorder',
        'version', '0.1.0',
        'defaultMode', 'mock',
        'triggers', jsonb_build_array(jsonb_build_object('id', 'fixture_run', 'kind', 'fixture')),
        'nodes', jsonb_build_array(
          jsonb_build_object('kind', 'source_sync', 'allowedTools', jsonb_build_array('read_fixture_records')),
          jsonb_build_object('kind', 'validation', 'allowedTools', jsonb_build_array('validate_fixture_event')),
          jsonb_build_object('kind', 'routing', 'allowedTools', jsonb_build_array('route_work_item')),
          jsonb_build_object('kind', 'context_assembly', 'allowedTools', jsonb_build_array('assemble_context_packet')),
          jsonb_build_object('kind', 'recommendation', 'allowedTools', jsonb_build_array('compute_reorder_recommendation')),
          jsonb_build_object('kind', 'draft_action', 'allowedTools', jsonb_build_array('create_mock_action_draft')),
          jsonb_build_object('kind', 'human_approval', 'allowedTools', jsonb_build_array('record_human_decision')),
          jsonb_build_object('kind', 'mock_execution', 'allowedTools', jsonb_build_array('execute_mock_action')),
          jsonb_build_object('kind', 'audit', 'allowedTools', jsonb_build_array('write_workflow_audit_event'))
        ),
        'allowedActions', jsonb_build_array(
          jsonb_build_object('actionType', 'create_mock_purchase_order_draft', 'mode', 'mock', 'requiresApproval', false),
          jsonb_build_object('actionType', 'execute_mock_purchase_order', 'mode', 'mock', 'requiresApproval', true)
        )
      ),
      'skill_markdown', '# Fixture',
      'compile_result', jsonb_build_object('ok', true)
    ),
    'run', jsonb_build_object(
      'id', '31000000-0000-0000-0000-000000000010',
      'company_id', '20000000-0000-0000-0000-000000000001',
      'workflow_id', '30000000-0000-0000-0000-000000000010',
      'workflow_type', 'procurement_reorder',
      'status', 'suppressed',
      'input', jsonb_build_object('scenarioId', 'no_action'),
      'langgraph_thread_id', 'fixture-thread',
      'langgraph_checkpoint_id', 'fixture-checkpoint',
      'langsmith_trace_id', 'fixture-trace',
      'langsmith_run_id', 'fixture-run',
      'started_by', '10000000-0000-0000-0000-000000000003',
      'started_at', now(),
      'completed_at', now()
    ),
    'event', jsonb_build_object(
      'id', '32000000-0000-0000-0000-000000000010',
      'company_id', '20000000-0000-0000-0000-000000000001',
      'workflow_run_id', '31000000-0000-0000-0000-000000000010',
      'workflow_id', '30000000-0000-0000-0000-000000000010',
      'event_key', 'procurement_reorder:snapshot-1',
      'event_type', 'fixture_inventory_snapshot',
      'origin', 'fixture',
      'source_ref', jsonb_build_object('scenarioId', 'no_action', 'snapshotId', 'snapshot-1'),
      'payload', jsonb_build_object('synthetic', true),
      'freshness_state', 'fresh',
      'validation_status', 'pass',
      'validation_result', jsonb_build_object('status', 'pass'),
      'created_at', now()
    ),
    'item', NULL,
    'context_packet', NULL,
    'recommendation', NULL,
    'evidence', NULL,
    'draft', NULL,
    'audit_events', jsonb_build_array(jsonb_build_object(
      'id', '39000000-0000-0000-0000-000000000010',
      'company_id', '20000000-0000-0000-0000-000000000001',
      'actor_type', 'system_agent',
      'actor_id', NULL,
      'workflow_run_id', '31000000-0000-0000-0000-000000000010',
      'workflow_item_id', NULL,
      'event_type', 'event_validated',
      'summary', 'Fixture event validated.',
      'payload', jsonb_build_object('synthetic', true),
      'trace', jsonb_build_object('langSmithTraceId', 'fixture-trace'),
      'created_at', now()
    ))
  )
);

SELECT ok(
  pg_get_functiondef('workflow_private.persist_workflow_fixture_run(jsonb)'::regprocedure)
    LIKE '%pg_advisory_xact_lock%',
  'fixture persistence serializes duplicate event keys before insertion'
);

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.persist_workflow_fixture_run_controlled(
      jsonb_set(payload, '{definition,workflow_type}', '"unregistered_fixture"'::jsonb),
      repeat('4', 64),
      'api'
    ) FROM fixture_payloads$$,
  '22023',
  'fixture_adapter_not_allowed',
  'owner cannot persist an unregistered fixture workflow payload'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO fixture_results SELECT public.persist_workflow_fixture_run_controlled(payload, repeat('5', 64), 'api') FROM fixture_payloads$$,
  'first durable fixture event persists'
);
RESET ROLE;
SELECT is((SELECT result ->> 'duplicate' FROM fixture_results ORDER BY ctid DESC LIMIT 1), 'false', 'first fixture event is not duplicate');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO fixture_results SELECT public.persist_workflow_fixture_run_controlled(payload, repeat('6', 64), 'api') FROM fixture_payloads$$,
  'repeated durable fixture event returns a suppressed trace'
);
RESET ROLE;
SELECT is((SELECT result ->> 'duplicate' FROM fixture_results ORDER BY ctid DESC LIMIT 1), 'true', 'repeated fixture event is marked duplicate');
SELECT is((SELECT count(*) FROM public.workflow_events WHERE event_key = 'procurement_reorder:snapshot-1'), 1::bigint, 'duplicate fixture keeps one durable event');
SELECT is((SELECT count(*) FROM public.workflow_runs WHERE workflow_id = '30000000-0000-0000-0000-000000000010'), 2::bigint, 'duplicate fixture appends a suppressed run');
SELECT is((SELECT count(*) FROM public.workflow_audit_events WHERE event_type <> 'control_request_recorded' AND workflow_run_id IN (SELECT id FROM public.workflow_runs WHERE workflow_id = '30000000-0000-0000-0000-000000000010')), 2::bigint, 'duplicate fixture appends its workflow audit event');

SELECT * FROM finish();
ROLLBACK;
