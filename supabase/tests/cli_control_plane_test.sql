BEGIN;
SELECT plan(46);

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
  ('41000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'control-owner-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('41000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'control-approver-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('41000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'control-member-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('41000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'control-outsider@example.test', '', now(), '{}', '{}', now(), now()),
  ('41000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'control-owner-b@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by)
VALUES
  ('42000000-0000-0000-0000-000000000001', 'Control Plane Company A', '41000000-0000-0000-0000-000000000001'),
  ('42000000-0000-0000-0000-000000000002', 'Control Plane Company B', '41000000-0000-0000-0000-000000000005');

INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES
  ('42000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', 'owner'),
  ('42000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000002', 'approver'),
  ('42000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000003', 'member'),
  ('42000000-0000-0000-0000-000000000002', '41000000-0000-0000-0000-000000000005', 'owner');

INSERT INTO public.agent_workflows (
  id,
  company_id,
  workflow_key,
  workflow_type,
  name,
  version,
  status,
  spec,
  created_by,
  updated_by
)
VALUES
  (
    '43000000-0000-0000-0000-000000000001',
    '42000000-0000-0000-0000-000000000001',
    'control_plane_fixture_a',
    'generic_mock_action',
    'Control Plane Fixture A',
    '0.1.0',
    'active',
    '{"defaultMode":"mock"}',
    '41000000-0000-0000-0000-000000000001',
    '41000000-0000-0000-0000-000000000001'
  ),
  (
    '43000000-0000-0000-0000-000000000002',
    '42000000-0000-0000-0000-000000000002',
    'control_plane_fixture_b',
    'generic_mock_action',
    'Control Plane Fixture B',
    '0.1.0',
    'active',
    '{"defaultMode":"mock"}',
    '41000000-0000-0000-0000-000000000005',
    '41000000-0000-0000-0000-000000000005'
  );

INSERT INTO public.company_approval_policies (
  company_id,
  workflow_type,
  action_type,
  minimum_role,
  require_human_approval,
  require_warning_acknowledgement
)
VALUES (
  '42000000-0000-0000-0000-000000000001',
  'generic_mock_action',
  'execute_mock_action',
  'approver',
  true,
  true
);

INSERT INTO public.workflow_runs (
  id,
  company_id,
  workflow_id,
  workflow_type,
  status,
  input,
  langgraph_thread_id,
  langgraph_checkpoint_id,
  langsmith_trace_id,
  langsmith_run_id,
  started_by
)
VALUES
  (
    '44000000-0000-0000-0000-000000000001',
    '42000000-0000-0000-0000-000000000001',
    '43000000-0000-0000-0000-000000000001',
    'generic_mock_action',
    'waiting_for_approval',
    '{}',
    'control-thread-a1',
    'control-checkpoint-a1',
    'control-trace-a1',
    'control-run-a1',
    '41000000-0000-0000-0000-000000000001'
  ),
  (
    '44000000-0000-0000-0000-000000000002',
    '42000000-0000-0000-0000-000000000001',
    '43000000-0000-0000-0000-000000000001',
    'generic_mock_action',
    'waiting_for_approval',
    '{}',
    'control-thread-a2',
    'control-checkpoint-a2',
    'control-trace-a2',
    'control-run-a2',
    '41000000-0000-0000-0000-000000000001'
  ),
  (
    '44000000-0000-0000-0000-000000000003',
    '42000000-0000-0000-0000-000000000002',
    '43000000-0000-0000-0000-000000000002',
    'generic_mock_action',
    'started',
    '{}',
    'control-thread-b1',
    'control-checkpoint-b1',
    'control-trace-b1',
    'control-run-b1',
    '41000000-0000-0000-0000-000000000005'
  );

INSERT INTO public.workflow_events (
  id,
  company_id,
  workflow_run_id,
  workflow_id,
  event_key,
  event_type,
  origin,
  source_ref,
  payload,
  freshness_state,
  validation_status,
  validation_result
)
VALUES
  (
    '45000000-0000-0000-0000-000000000001',
    '42000000-0000-0000-0000-000000000001',
    '44000000-0000-0000-0000-000000000001',
    '43000000-0000-0000-0000-000000000001',
    'control:event:a1',
    'fixture_snapshot',
    'fixture',
    '{}',
    '{}',
    'fresh',
    'pass',
    '{"status":"pass"}'
  ),
  (
    '45000000-0000-0000-0000-000000000002',
    '42000000-0000-0000-0000-000000000001',
    '44000000-0000-0000-0000-000000000002',
    '43000000-0000-0000-0000-000000000001',
    'control:event:a2',
    'fixture_snapshot',
    'fixture',
    '{}',
    '{}',
    'fresh',
    'pass',
    '{"status":"pass"}'
  ),
  (
    '45000000-0000-0000-0000-000000000003',
    '42000000-0000-0000-0000-000000000002',
    '44000000-0000-0000-0000-000000000003',
    '43000000-0000-0000-0000-000000000002',
    'control:event:b1',
    'fixture_snapshot',
    'fixture',
    '{}',
    '{}',
    'fresh',
    'pass',
    '{"status":"pass"}'
  );

INSERT INTO public.workflow_items (
  id,
  company_id,
  workflow_run_id,
  workflow_event_id,
  workflow_id,
  item_key,
  item_type,
  title,
  status
)
VALUES
  (
    '46000000-0000-0000-0000-000000000001',
    '42000000-0000-0000-0000-000000000001',
    '44000000-0000-0000-0000-000000000001',
    '45000000-0000-0000-0000-000000000001',
    '43000000-0000-0000-0000-000000000001',
    'control:item:a1',
    'generic_action_review',
    'Review control-plane action one',
    'active'
  ),
  (
    '46000000-0000-0000-0000-000000000002',
    '42000000-0000-0000-0000-000000000001',
    '44000000-0000-0000-0000-000000000002',
    '45000000-0000-0000-0000-000000000002',
    '43000000-0000-0000-0000-000000000001',
    'control:item:a2',
    'generic_action_review',
    'Review control-plane action two',
    'active'
  ),
  (
    '46000000-0000-0000-0000-000000000003',
    '42000000-0000-0000-0000-000000000002',
    '44000000-0000-0000-0000-000000000003',
    '45000000-0000-0000-0000-000000000003',
    '43000000-0000-0000-0000-000000000002',
    'control:item:b1',
    'generic_action_review',
    'Review company B action',
    'active'
  );

INSERT INTO public.workflow_context_packets (
  id,
  company_id,
  workflow_run_id,
  workflow_item_id,
  sources,
  facts,
  freshness_state
)
VALUES
  ('47000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000001', '[]', '{}', 'fresh'),
  ('47000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000002', '46000000-0000-0000-0000-000000000002', '[]', '{}', 'fresh');

INSERT INTO public.workflow_recommendation_runs (
  id,
  company_id,
  workflow_run_id,
  workflow_item_id,
  context_packet_id,
  status,
  rationale_summary,
  warning_state,
  warnings,
  confidence,
  freshness_state,
  input,
  output
)
VALUES
  (
    '48000000-0000-0000-0000-000000000001',
    '42000000-0000-0000-0000-000000000001',
    '44000000-0000-0000-0000-000000000001',
    '46000000-0000-0000-0000-000000000001',
    '47000000-0000-0000-0000-000000000001',
    'ready_for_review',
    'Ready for control-plane review.',
    'pass',
    '[]',
    0.900,
    'fresh',
    '{}',
    '{}'
  ),
  (
    '48000000-0000-0000-0000-000000000002',
    '42000000-0000-0000-0000-000000000001',
    '44000000-0000-0000-0000-000000000002',
    '46000000-0000-0000-0000-000000000002',
    '47000000-0000-0000-0000-000000000002',
    'ready_for_review',
    'Ready for role checks.',
    'pass',
    '[]',
    0.900,
    'fresh',
    '{}',
    '{}'
  );

INSERT INTO public.workflow_evidence_snapshots (
  id,
  company_id,
  workflow_run_id,
  workflow_item_id,
  recommendation_run_id,
  source_refs,
  assumptions,
  warnings,
  evidence
)
VALUES
  ('49000000-0000-0000-0000-000000000001', '42000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000001', '46000000-0000-0000-0000-000000000001', '48000000-0000-0000-0000-000000000001', '[]', '[]', '[]', '[]'),
  ('49000000-0000-0000-0000-000000000002', '42000000-0000-0000-0000-000000000001', '44000000-0000-0000-0000-000000000002', '46000000-0000-0000-0000-000000000002', '48000000-0000-0000-0000-000000000002', '[]', '[]', '[]', '[]');

WITH draft_payloads(id, run_id, item_id, recommendation_id, evidence_id, payload) AS (
  VALUES
    (
      '4a000000-0000-0000-0000-000000000001'::UUID,
      '44000000-0000-0000-0000-000000000001'::UUID,
      '46000000-0000-0000-0000-000000000001'::UUID,
      '48000000-0000-0000-0000-000000000001'::UUID,
      '49000000-0000-0000-0000-000000000001'::UUID,
      '{"mode":"mock","operation":"control-fixture-one"}'::JSONB
    ),
    (
      '4a000000-0000-0000-0000-000000000002'::UUID,
      '44000000-0000-0000-0000-000000000002'::UUID,
      '46000000-0000-0000-0000-000000000002'::UUID,
      '48000000-0000-0000-0000-000000000002'::UUID,
      '49000000-0000-0000-0000-000000000002'::UUID,
      '{"mode":"mock","operation":"control-fixture-two"}'::JSONB
    )
)
INSERT INTO public.workflow_action_drafts (
  id,
  company_id,
  workflow_run_id,
  workflow_item_id,
  recommendation_run_id,
  evidence_snapshot_id,
  action_type,
  status,
  payload,
  payload_hash
)
SELECT
  id,
  '42000000-0000-0000-0000-000000000001',
  run_id,
  item_id,
  recommendation_id,
  evidence_id,
  'execute_mock_action',
  'pending_review',
  payload,
  encode(extensions.digest(convert_to(payload::TEXT, 'UTF8'), 'sha256'), 'hex')
FROM draft_payloads;

SELECT ok(
  (
    SELECT relation.relrowsecurity
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'workflow_control_requests'
  ),
  'workflow control requests have RLS enabled'
);
SELECT ok(has_table_privilege('authenticated', 'public.workflow_control_request_audit', 'SELECT'), 'authenticated can select the safe control-request audit view');
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_control_requests', 'INSERT'), 'authenticated cannot insert control requests directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_control_requests', 'UPDATE'), 'authenticated cannot update control requests directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_control_requests', 'DELETE'), 'authenticated cannot delete control requests directly');
SELECT ok(NOT has_table_privilege('anon', 'public.workflow_control_requests', 'SELECT'), 'anon cannot select control requests');
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_execution_tokens', 'SELECT'), 'execution token rows remain unselectable');
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_execution_tokens', 'INSERT'), 'authenticated cannot insert execution tokens directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.workflow_execution_tokens', 'UPDATE'), 'authenticated cannot update execution tokens directly');
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.record_workflow_control_request(uuid,text,text,jsonb,text,text,text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'anon cannot call the control-request RPC'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.record_workflow_control_request(uuid,text,text,jsonb,text,text,text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated can call the checked control-request RPC'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.reissue_workflow_execution_token(uuid,uuid)', 'EXECUTE'),
  'anon cannot call the token-reissue RPC'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.reissue_workflow_execution_token(uuid,uuid)', 'EXECUTE'),
  'authenticated can call the checked token-reissue RPC'
);
SELECT is(
  (
    SELECT pg_get_function_result(
      'public.record_workflow_control_request(uuid,text,text,jsonb,text,text,text,uuid,uuid,text,text)'::REGPROCEDURE
    )
  ),
  'jsonb',
  'control-request public RPC returns jsonb'
);
SELECT is(
  (
    SELECT procedure.pronargdefaults::INTEGER
    FROM pg_proc procedure
    WHERE procedure.oid =
      'public.record_workflow_control_request(uuid,text,text,jsonb,text,text,text,uuid,uuid,text,text)'::REGPROCEDURE
  ),
  4,
  'control-request public RPC exposes four trailing defaults'
);
SELECT is(
  (
    SELECT pg_get_function_result(
      'public.reissue_workflow_execution_token(uuid,uuid)'::REGPROCEDURE
    )
  ),
  'jsonb',
  'token-reissue public RPC returns jsonb'
);

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$INSERT INTO public.workflow_control_requests (
      company_id,
      actor_id,
      client_surface,
      input_hash,
      normalized_intent,
      parser_kind,
      resolution_status,
      risk_class
    ) VALUES (
      '42000000-0000-0000-0000-000000000001',
      '41000000-0000-0000-0000-000000000001',
      'cli',
      repeat('a', 64),
      '{"kind":"list_work_items"}',
      'explicit',
      'resolved',
      'read'
    )$$,
  '42501',
  'permission denied for table workflow_control_requests',
  'authenticated cannot spoof an actor through a direct insert'
);
RESET ROLE;

CREATE TEMP TABLE control_results (result JSONB) ON COMMIT DROP;
CREATE TEMP TABLE approval_results (label TEXT PRIMARY KEY, result JSONB) ON COMMIT DROP;
CREATE TEMP TABLE reissue_results (result JSONB) ON COMMIT DROP;
CREATE TEMP TABLE execution_results (result JSONB) ON COMMIT DROP;
GRANT SELECT, INSERT ON control_results, approval_results, reissue_results, execution_results TO authenticated;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO control_results
    SELECT public.record_workflow_control_request(
      '42000000-0000-0000-0000-000000000001',
      'cli',
      repeat('b', 64),
      '{"kind":"list_work_items","companyId":"42000000-0000-0000-0000-000000000001","risk":"read"}',
      'explicit',
      'resolved',
      'read',
      NULL,
      '46000000-0000-0000-0000-000000000001'
    )$$,
  'active company member records a control request'
);
RESET ROLE;

SELECT is(
  (SELECT result ->> 'actor_id' FROM control_results LIMIT 1),
  '41000000-0000-0000-0000-000000000003',
  'control-request actor is derived from auth.uid'
);
SELECT is(
  (SELECT result ->> 'workflow_run_id' FROM control_results LIMIT 1),
  '44000000-0000-0000-0000-000000000001',
  'control-request run is derived from the linked item'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'workflow_control_requests'
      AND column_info.column_name IN ('raw_input', 'raw_command', 'command_text', 'prompt', 'message')
  ),
  'control-request schema persists an input hash but no raw input column'
);
SELECT is(
  (
    SELECT audit.payload
    FROM public.workflow_audit_events audit
    WHERE audit.event_type = 'control_request_recorded'
      AND audit.payload ->> 'controlRequestId' = (SELECT result ->> 'id' FROM control_results LIMIT 1)
  ),
  jsonb_build_object(
    'controlRequestId', (SELECT (result ->> 'id')::UUID FROM control_results LIMIT 1),
    'clientSurface', 'cli',
    'intentKind', 'list_work_items',
    'riskClass', 'read',
    'resolutionStatus', 'resolved'
  ),
  'control request appends an exact product-audit link without raw input'
);
SELECT is(
  (
    SELECT audit.trace
    FROM public.workflow_audit_events audit
    WHERE audit.event_type = 'control_request_recorded'
      AND audit.payload ->> 'controlRequestId' = (SELECT result ->> 'id' FROM control_results LIMIT 1)
  ),
  jsonb_build_object(
    'langGraphThreadId', 'control-thread-a1',
    'langGraphCheckpointId', 'control-checkpoint-a1',
    'langSmithTraceId', 'control-trace-a1',
    'langSmithRunId', 'control-run-a1'
  ),
  'control-request audit copies workflow run correlation identifiers'
);

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.workflow_control_request_audit),
  1::BIGINT,
  'company member can select their company control request'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*) FROM public.workflow_control_request_audit),
  0::BIGINT,
  'control-request RLS isolates another company'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.record_workflow_control_request(
      '42000000-0000-0000-0000-000000000001',
      'cli',
      repeat('c', 64),
      '{"kind":"list_work_items","companyId":"42000000-0000-0000-0000-000000000001","risk":"read"}',
      'explicit',
      'resolved',
      'read'
    )$$,
  '42501',
  'forbidden',
  'non-member cannot record a control request'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.record_workflow_control_request(
      '42000000-0000-0000-0000-000000000001',
      'cli',
      repeat('d', 64),
      '{"kind":"inspect_work_item","companyId":"42000000-0000-0000-0000-000000000001","itemId":"46000000-0000-0000-0000-000000000003","risk":"read"}',
      'explicit',
      'resolved',
      'read',
      '44000000-0000-0000-0000-000000000003'
    )$$,
  '22023',
  'linked_run_company_mismatch',
  'control request rejects a run from another company'
);
SELECT throws_ok(
  $$SELECT public.record_workflow_control_request(
      '42000000-0000-0000-0000-000000000001',
      'cli',
      repeat('e', 64),
      '{"kind":"inspect_work_item","companyId":"42000000-0000-0000-0000-000000000001","itemId":"46000000-0000-0000-0000-000000000003","risk":"read"}',
      'explicit',
      'resolved',
      'read',
      NULL,
      '46000000-0000-0000-0000-000000000003'
    )$$,
  '22023',
  'linked_item_company_mismatch',
  'control request rejects an item from another company'
);
SELECT throws_ok(
  $$SELECT public.record_workflow_control_request(
      '42000000-0000-0000-0000-000000000001',
      'cli',
      repeat('f', 64),
      '{"kind":"list_work_items","companyId":"42000000-0000-0000-0000-000000000001","risk":"read","metadata":{"RAW_INPUT":"show every item"}}',
      'explicit',
      'resolved',
      'read'
    )$$,
  '22023',
  'invalid_control_request',
  'control request rejects normalized intent carrying raw input'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$INSERT INTO approval_results
    SELECT
      'rotation',
      public.record_workflow_decision_controlled(
        '42000000-0000-0000-0000-000000000001',
        '4a000000-0000-0000-0000-000000000001',
        'approve',
        repeat('7', 64),
        'cli',
        NULL,
        false,
        NULL
      )$$,
  'approver creates the initial execution token for rotation'
);
SELECT lives_ok(
  $$INSERT INTO approval_results
    SELECT
      'role-check',
      public.record_workflow_decision_controlled(
        '42000000-0000-0000-0000-000000000001',
        '4a000000-0000-0000-0000-000000000002',
        'approve',
        repeat('8', 64),
        'cli',
        NULL,
        false,
        NULL
      )$$,
  'approver prepares a second approved draft for authorization checks'
);
SELECT lives_ok(
  $$INSERT INTO reissue_results
    SELECT public.reissue_workflow_execution_token(
      '42000000-0000-0000-0000-000000000001',
      '4a000000-0000-0000-0000-000000000001'
    )$$,
  'approver rotates an approved unexecuted draft token'
);
RESET ROLE;

SELECT ok(
  (
    SELECT
      result ? 'decisionId'
      AND result ? 'executionToken'
      AND result - 'decisionId' - 'executionToken' = '{}'::JSONB
      AND (result -> 'executionToken') ?& ARRAY['id', 'rawToken', 'expiresAt']
      AND (result -> 'executionToken') - 'id' - 'rawToken' - 'expiresAt' = '{}'::JSONB
    FROM reissue_results
    LIMIT 1
  ),
  'token-reissue result has the exact decision and execution-token envelope'
);
SELECT is(
  (SELECT result ->> 'decisionId' FROM reissue_results LIMIT 1),
  (SELECT result #>> '{decision,id}' FROM approval_results WHERE label = 'rotation'),
  'token-reissue result identifies the authorizing decision'
);
SELECT ok(
  (SELECT result #>> '{executionToken,rawToken}' FROM reissue_results LIMIT 1) ~ '^[0-9a-f]{64}$',
  'token reissue returns one 32-byte raw capability encoded as hex'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.workflow_execution_tokens token_row
    WHERE token_row.action_draft_id = '4a000000-0000-0000-0000-000000000001'
      AND token_row.token_hash = encode(
        extensions.digest(
          convert_to(
            (SELECT result #>> '{executionToken,rawToken}' FROM approval_results WHERE label = 'rotation'),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
      AND token_row.revoked_at IS NOT NULL
      AND token_row.revoked_by = '41000000-0000-0000-0000-000000000002'
      AND token_row.consumed_at IS NULL
  ),
  'token rotation revokes the prior active token and attributes the revocation'
);
SELECT is(
  (
    SELECT count(*)
    FROM public.workflow_execution_tokens token_row
    WHERE token_row.action_draft_id = '4a000000-0000-0000-0000-000000000001'
      AND token_row.consumed_at IS NULL
      AND token_row.revoked_at IS NULL
      AND token_row.expires_at > now()
  ),
  1::BIGINT,
  'token rotation leaves exactly one active execution capability'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.workflow_audit_events audit
    WHERE audit.event_type = 'execution_token_reissued'
      AND audit.payload ?& ARRAY[
        'actionDraftId',
        'decisionId',
        'executionTokenId',
        'revokedExecutionTokenIds',
        'payloadHash'
      ]
      AND audit.payload
        - 'actionDraftId'
        - 'decisionId'
        - 'executionTokenId'
        - 'revokedExecutionTokenIds'
        - 'payloadHash' = '{}'::JSONB
  ),
  'token reissue appends an audit event containing only IDs and payload hash'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.workflow_audit_events audit
    CROSS JOIN reissue_results reissue
    CROSS JOIN approval_results approval
    WHERE audit.event_type = 'execution_token_reissued'
      AND approval.label = 'rotation'
      AND (
        audit.payload::TEXT LIKE '%' || (reissue.result #>> '{executionToken,rawToken}') || '%'
        OR audit.trace::TEXT LIKE '%' || (reissue.result #>> '{executionToken,rawToken}') || '%'
        OR audit.summary LIKE '%' || (reissue.result #>> '{executionToken,rawToken}') || '%'
        OR audit.payload::TEXT LIKE '%' || (approval.result #>> '{executionToken,rawToken}') || '%'
      )
  ),
  'token reissue never writes a raw capability to audit storage'
);

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.execute_mock_workflow_action_controlled(
      '42000000-0000-0000-0000-000000000001',
      '4a000000-0000-0000-0000-000000000001',
      (SELECT (result ->> 'decisionId')::UUID FROM reissue_results LIMIT 1),
      (SELECT result #>> '{executionToken,rawToken}' FROM approval_results WHERE label = 'rotation'),
      'cli:00000000-0000-4000-8000-000000000001',
      '{"mode":"mock","operation":"control-fixture-one"}'::JSONB,
      repeat('9', 64),
      'cli'
    )$$,
  '55000',
  'token_revoked',
  'revoked execution token is rejected explicitly'
);
SELECT lives_ok(
  $$INSERT INTO execution_results
    SELECT public.execute_mock_workflow_action_controlled(
      '42000000-0000-0000-0000-000000000001',
      '4a000000-0000-0000-0000-000000000001',
      (SELECT (result ->> 'decisionId')::UUID FROM reissue_results LIMIT 1),
      (SELECT result #>> '{executionToken,rawToken}' FROM reissue_results LIMIT 1),
      'cli:00000000-0000-4000-8000-000000000002',
      '{"mode":"mock","operation":"control-fixture-one"}'::JSONB,
      repeat('a', 64),
      'cli'
    )$$,
  'newly reissued execution token completes the mock action'
);
SELECT throws_ok(
  $$SELECT public.execute_mock_workflow_action_controlled(
      '42000000-0000-0000-0000-000000000001',
      '4a000000-0000-0000-0000-000000000001',
      (SELECT (result ->> 'decisionId')::UUID FROM reissue_results LIMIT 1),
      (SELECT result #>> '{executionToken,rawToken}' FROM approval_results WHERE label = 'rotation'),
      'cli:00000000-0000-4000-8000-000000000002',
      '{"mode":"mock","operation":"control-fixture-one"}'::JSONB,
      repeat('b', 64),
      'cli'
    )$$,
  '55000',
  'token_revoked',
  'revoked token cannot replay an already-completed idempotency key'
);
RESET ROLE;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.workflow_action_attempts attempt_row
    JOIN public.workflow_execution_tokens token_row
      ON token_row.id = attempt_row.execution_token_id
    WHERE attempt_row.action_draft_id = '4a000000-0000-0000-0000-000000000001'
      AND attempt_row.execution_token_id =
        (SELECT (result #>> '{executionToken,id}')::UUID FROM reissue_results LIMIT 1)
      AND token_row.consumed_at IS NOT NULL
      AND token_row.revoked_at IS NULL
  ),
  'successful execution consumes only the reissued token'
);

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.reissue_workflow_execution_token(
      '42000000-0000-0000-0000-000000000001',
      '4a000000-0000-0000-0000-000000000001'
    )$$,
  '55000',
  'action_already_attempted',
  'draft with an action attempt cannot receive another token'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.reissue_workflow_execution_token(
      '42000000-0000-0000-0000-000000000001',
      '4a000000-0000-0000-0000-000000000002'
    )$$,
  '42501',
  'forbidden',
  'company member below the approval-policy role cannot reissue a token'
);
RESET ROLE;

SELECT set_config('request.jwt.claim.sub', '41000000-0000-0000-0000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"41000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.reissue_workflow_execution_token(
      '42000000-0000-0000-0000-000000000001',
      '4a000000-0000-0000-0000-000000000002'
    )$$,
  '42501',
  'forbidden',
  'user from another company cannot reissue a token'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
