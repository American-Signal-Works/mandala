BEGIN;
SELECT no_plan();

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('91000000-0000-4000-8000-000000000001','authenticated','authenticated','cycle-owner@example.test','',now(),'{}','{}',now(),now()),
  ('91000000-0000-4000-8000-000000000002','authenticated','authenticated','cycle-outsider@example.test','',now(),'{}','{}',now(),now()),
  ('91000000-0000-4000-8000-000000000003','authenticated','authenticated','cycle-approver@example.test','',now(),'{}','{}',now(),now()),
  ('91000000-0000-4000-8000-000000000004','authenticated','authenticated','cycle-cascade-actor@example.test','',now(),'{}','{}',now(),now());

INSERT INTO public.companies (id, name, created_by) VALUES
  ('92000000-0000-4000-8000-000000000001','Cycle Company','91000000-0000-4000-8000-000000000001'),
  ('92000000-0000-4000-8000-000000000002','Other Company','91000000-0000-4000-8000-000000000002');
INSERT INTO public.company_memberships (company_id, user_id, role) VALUES
  ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','owner'),
  ('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','owner'),
  ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000003','approver');

INSERT INTO public.agent_workflows (
  id, company_id, workflow_key, workflow_type, name, version, status, spec
) VALUES (
  '93000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
  'cycle_review','procurement_reorder','Cycle review','1.0.0','active','{}'
);
INSERT INTO public.workflow_runs (
  id, company_id, workflow_id, workflow_type, status, input
) VALUES (
  '94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001','procurement_reorder','waiting_for_approval','{}'
);
INSERT INTO public.workflow_events (
  id, company_id, workflow_run_id, workflow_id, event_key, event_type,
  origin, source_ref, payload, freshness_state, validation_status,
  validation_result
) VALUES (
  '95000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001',
  'cycle-event','fixture_inventory_snapshot','fixture','{}','{}','fresh','pass','{}'
);

INSERT INTO public.workflow_items (
  id, company_id, workflow_run_id, workflow_event_id, workflow_id, item_key,
  item_type, title, status, priority, related_records, owner_role,
  assignee_id, due_at
) VALUES
  ('96000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','ready-item','procurement_reorder_review','Review COFFEE-READY reorder','active',90,'{"sku":"COFFEE-READY","vendor":"Safe Vendor"}','approver','91000000-0000-4000-8000-000000000001',now()+interval '1 day'),
  ('96000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','stale-item','procurement_reorder_review','Review stale reorder','active',80,'{"sku":"COFFEE-STALE","vendor":"Safe Vendor"}','approver',NULL,now()+interval '2 days'),
  ('96000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','missing-item','procurement_reorder_review','Review missing context','active',70,'{"sku":"COFFEE-MISSING"}','approver',NULL,NULL),
  ('96000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','blocked-item','procurement_reorder_review','Resolve blocked work','blocked',60,'{}','approver',NULL,NULL),
  ('96000000-0000-4000-8000-000000000005','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','approved-item','procurement_reorder_review','Approved work','approved',50,'{}','approver',NULL,NULL),
  ('96000000-0000-4000-8000-000000000006','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','resolved-item','procurement_reorder_review','Resolved work','resolved',40,'{}','approver',NULL,NULL);

INSERT INTO public.workflow_context_packets (
  id, company_id, workflow_run_id, workflow_item_id, sources, facts,
  memory_refs, freshness_state, warnings
) VALUES
  ('97000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','[{"label":"Inventory","apiKey":"must-not-leak"}]','{"inventory":2,"nested":{"Authorization":"Bearer abcdefghijklmnop"},"prompt":"hidden"}','[{"private":"memory"}]','fresh','[]'),
  ('97000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','[]','{"inventory":3}','[]','stale','[]');
INSERT INTO public.workflow_recommendation_runs (
  id, company_id, workflow_run_id, workflow_item_id, context_packet_id,
  status, rationale_summary, warning_state, warnings, confidence,
  freshness_state, input, output
) VALUES
  ('98000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','ready_for_review','Inventory is low; secret=review-secret-1234','pass','[]',0.9,'fresh','{}','{"quantity":12,"tokenHash":"must-not-leak"}'),
  ('98000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000002','ready_for_review','Inventory is stale.','pass','[]',0.8,'stale','{}','{"quantity":8}');
INSERT INTO public.workflow_evidence_snapshots (
  id, company_id, workflow_run_id, workflow_item_id, recommendation_run_id,
  source_refs, assumptions, warnings, evidence
) VALUES
  ('99000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','[]','[]','[]','[{"fact":"low inventory","Secret":"must-not-leak"}]'),
  ('99000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000002','[]','[]','[]','[{"fact":"old inventory"}]');
INSERT INTO public.workflow_action_drafts (
  id, company_id, workflow_run_id, workflow_item_id, recommendation_run_id,
  evidence_snapshot_id, action_type, status, payload, payload_hash, edit_policy
) VALUES
  ('9a000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001','execute_mock_purchase_order','pending_review','{"vendor":"Safe Vendor","mode":"mock","lines":[{"sku":"COFFEE-READY","quantity":12,"reason":"low"}]}',repeat('a',64),'{"editable":true,"requireReason":true,"immutablePaths":[["vendor"],["mode"],["lines","0","sku"]],"arrayLengthPaths":[["lines"]],"positiveIntegerPaths":[["lines","0","quantity"]],"nonEmptyStringPaths":[["lines","0","reason"]]}'),
  ('9a000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','98000000-0000-4000-8000-000000000002','99000000-0000-4000-8000-000000000002','execute_mock_purchase_order','pending_review','{"vendor":"Safe Vendor","mode":"mock","lines":[{"sku":"COFFEE-STALE","quantity":8,"reason":"old"}]}',repeat('b',64),'{"editable":false,"requireReason":true,"immutablePaths":[],"arrayLengthPaths":[],"positiveIntegerPaths":[],"nonEmptyStringPaths":[]}');
INSERT INTO public.workflow_action_drafts (
  id, company_id, workflow_run_id, workflow_item_id, recommendation_run_id,
  evidence_snapshot_id, action_type, status, payload, payload_hash, edit_policy,
  created_at, updated_at
) VALUES (
  '9a000000-0000-4000-8000-000000000009','92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001',
  'execute_mock_purchase_order','pending_review','{"vendor":"Old Safe Vendor","mode":"mock","lines":[]}',
  repeat('9',64),'{"editable":false,"requireReason":true,"immutablePaths":[],"arrayLengthPaths":[]}',
  now()-interval '1 day',now()-interval '1 day'
);
INSERT INTO public.company_approval_policies (
  company_id, workflow_type, action_type, minimum_role,
  require_human_approval, require_warning_acknowledgement
) VALUES (
  '92000000-0000-4000-8000-000000000001','procurement_reorder',
  'execute_mock_purchase_order','owner',true,true
);
INSERT INTO public.workflow_audit_events (
  id, company_id, actor_type, actor_id, workflow_run_id, workflow_item_id,
  event_type, summary, payload, trace
) VALUES (
  '9b000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',
  'system_agent',NULL,'94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',
  'recommendation_created','Recommendation created with rk-abcdefgh12345678',
  '{"recommendationRunId":"98000000-0000-4000-8000-000000000001","rawToken":"must-not-leak"}',
  '{"langsmithTraceId":"must-not-leak"}'
);

SELECT ok(has_function_privilege('authenticated','public.list_workflow_queue_v1(uuid,jsonb)','EXECUTE'),'authenticated may call the queue RPC');
SELECT ok(NOT has_function_privilege('anon','public.list_workflow_queue_v1(uuid,jsonb)','EXECUTE'),'anonymous callers cannot call the queue RPC');
SELECT ok(has_function_privilege('authenticated','public.record_workflow_decision_v2(uuid,uuid,text,text,text,uuid,text,boolean,jsonb)','EXECUTE'),'authenticated callers may use the checked decision v2 RPC');
SELECT ok(NOT has_function_privilege('authenticated','public.record_workflow_decision(uuid,uuid,text,text,boolean,jsonb)','EXECUTE'),'authenticated callers cannot invoke the legacy public decision RPC');
SELECT ok(NOT has_function_privilege('authenticated','workflow_private.record_workflow_decision(uuid,uuid,text,text,boolean,jsonb)','EXECUTE'),'authenticated callers cannot invoke the legacy private decision helper');
SELECT ok(NOT has_table_privilege('authenticated','workflow_private.workflow_decision_receipts','SELECT'),'decision receipts stay private');
SELECT ok(NOT has_table_privilege('authenticated','workflow_private.workflow_queue_snapshots','SELECT'),'queue snapshots stay private');
SELECT ok(
  NOT has_table_privilege('authenticated','public.workflow_runs','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_events','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_items','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_context_packets','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_recommendation_runs','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_evidence_snapshots','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_action_drafts','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_decisions','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_execution_tokens','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_action_attempts','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_audit_events','SELECT')
  AND NOT has_table_privilege('authenticated','public.workflow_decision_outcomes','SELECT'),
  'authenticated callers cannot select any raw workflow payload or history table'
);

SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(workflow_private.normalize_workflow_queue_query('{}')->>'limit','50','queue normalizer handles defaults independently');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"statuses":"active"}')$$,'22023','invalid_queue_query','statuses must be an array');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"statuses":[]}')$$,'22023','invalid_queue_query','provided status filters cannot be empty');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"itemTypes":[]}')$$,'22023','invalid_queue_query','provided item type filters cannot be empty');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"itemTypes":["bad item"]}')$$,'22023','invalid_queue_query','item types follow the public identifier grammar');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query(jsonb_build_object('itemTypes',jsonb_build_array(repeat('a',101))))$$,'22023','invalid_queue_query','oversized item type identifiers are rejected');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"priorities":[1.5]}')$$,'22023','invalid_queue_query','priorities must be integers');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"priorities":[101]}')$$,'22023','invalid_queue_query','priorities stay in the public 0 through 100 range');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"sourceTypes":{}}')$$,'22023','invalid_queue_query','source types must be an array');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"sourceTypes":["bad source"]}')$$,'22023','invalid_queue_query','source types follow the public identifier grammar');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"ownerRoles":[]}')$$,'22023','invalid_queue_query','provided owner role filters cannot be empty');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"ownerRoles":["superuser"]}')$$,'22023','invalid_queue_query','owner roles use the approved enum');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"assigneeIds":["not-a-uuid"]}')$$,'22023','invalid_queue_query','assignee filters require UUIDs');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"sort":{"key":"priority"}}')$$,'22023','invalid_queue_query','partial sort objects are rejected');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"sort":{"key":"priority","direction":"desc","extra":true}}')$$,'22023','invalid_queue_query','extra sort keys are rejected');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"limit":1.5}')$$,'22023','invalid_queue_query','fractional limits are rejected');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"limit":999999999999999999999}')$$,'22023','invalid_queue_query','overflow limits are rejected');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"snapshotId":"96000000-0000-4000-8000-000000000001","position":1.5}')$$,'22023','invalid_queue_cursor','fractional cursor positions are rejected');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query('{"snapshotId":"96000000-0000-4000-8000-000000000001","position":99999}')$$,'22023','invalid_queue_cursor','overflow cursor positions are rejected');
SELECT throws_ok($$SELECT workflow_private.normalize_workflow_queue_query(jsonb_build_object('search',repeat('x',17000)))$$,'22023','invalid_queue_query','oversized queue queries are rejected before storage');
SELECT is(
  workflow_private.sanitize_public_jsonb(jsonb_build_array(
    'sk-abcdefgh12345678',
    'rk-abcdefgh12345678',
    'pk-abcdefgh12345678',
    'secret=plain-secret-value',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz',
    '-----BEGIN PRIVATE KEY-----',
    'Password: correct-horse-battery-staple',
    'webhook_secret=whsec_abcdefgh'
  )),
  '["[redacted]","[redacted]","[redacted]","[redacted]","[redacted]","[redacted]","[redacted]","[redacted]"]'::JSONB,
  'secret-looking scalar values are redacted across token, key, and labelled-secret formats'
);
SELECT is(cardinality(workflow_private.workflow_queue_item_ids('92000000-0000-4000-8000-000000000001',workflow_private.normalize_workflow_queue_query('{}'))),5,'queue item-id selector is bounded and independent');
SELECT is(workflow_private.workflow_queue_item_projection('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','owner')->>'id','96000000-0000-4000-8000-000000000001','queue projection is independently safe');
SELECT is(jsonb_array_length(workflow_private.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{}')->'items'),5,'private snapshot coordinator composes bounded helpers');
SELECT set_config('test.queue_before_insert',workflow_private.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{"limit":2}')::TEXT,true);
INSERT INTO public.workflow_items(id,company_id,workflow_run_id,workflow_event_id,workflow_id,item_key,item_type,title,status,priority,related_records,source_type)
VALUES('96000000-0000-4000-8000-000000000097','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','new-after-snapshot','procurement_reorder_review','New after snapshot','active',100,'{}','fixture');
SELECT set_config('test.queue_after_insert',workflow_private.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{}')::TEXT,true);
SELECT ok((current_setting('test.queue_after_insert')::JSONB->'items') @> '[{"id":"96000000-0000-4000-8000-000000000097"}]','a second cursorless queue request sees newly inserted work');
SELECT set_config('test.queue_old_continuation',workflow_private.list_workflow_queue_v1(
  '92000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'limit',100,
    'snapshotId',current_setting('test.queue_before_insert')::JSONB #>> '{nextPage,snapshotId}',
    'position',(current_setting('test.queue_before_insert')::JSONB #>> '{nextPage,position}')::INTEGER
  )
)::TEXT,true);
SELECT ok(NOT ((current_setting('test.queue_old_continuation')::JSONB->'items') @> '[{"id":"96000000-0000-4000-8000-000000000097"}]'),'the first cursor continuation preserves its original snapshot membership');
UPDATE public.workflow_items
SET status='resolved'
WHERE id='96000000-0000-4000-8000-000000000097';
SELECT is((SELECT count(*)::INTEGER FROM workflow_private.workflow_queue_snapshots WHERE actor_id='91000000-0000-4000-8000-000000000001'),3,'each cursorless request creates a fresh bounded snapshot');
INSERT INTO workflow_private.workflow_queue_snapshots(id,company_id,actor_id,query_hash,item_ids,created_at,expires_at)
VALUES('9c000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',repeat('f',64),'{}',now()-interval '2 hours',now()-interval '1 hour');
DO $$
BEGIN
  FOR counter IN 1..25 LOOP
    PERFORM workflow_private.list_workflow_queue_v1(
      '92000000-0000-4000-8000-000000000001',
      jsonb_build_object('search','snapshot-cap-'||counter)
    );
  END LOOP;
END
$$;
SELECT is((SELECT count(*)::INTEGER FROM workflow_private.workflow_queue_snapshots WHERE actor_id='91000000-0000-4000-8000-000000000001' AND expires_at>now()),20,'active queue snapshots are capped at twenty per actor');
SELECT is((SELECT count(*)::INTEGER FROM workflow_private.workflow_queue_snapshots WHERE id='9c000000-0000-4000-8000-000000000001'),0,'expired snapshots are cleaned globally');
SELECT throws_ok($$INSERT INTO public.workflow_items(id,company_id,workflow_run_id,workflow_event_id,workflow_id,item_key,item_type,title,status,priority,related_records,source_type) VALUES('96000000-0000-4000-8000-000000000099','92000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','bad-source-item','procurement_reorder_review','Bad source','active',1,'{}','bad source')$$,'23514',NULL,'stored source types use the same public identifier grammar');
SELECT throws_ok($$INSERT INTO public.workflow_items(id,company_id,workflow_run_id,workflow_event_id,workflow_id,item_key,item_type,title,status,priority,related_records) VALUES('96000000-0000-4000-8000-000000000098','92000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','cross-company-item','procurement_reorder_review','Cross company','active',1,'{}')$$,'23503',NULL,'cross-company workflow foreign-key injection is rejected');
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT is(public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{"search":"COFFEE-READY"}') #> '{items,0,nextActions}','[]'::JSONB,'queue actions honor an owner-only selected-draft policy for an approver');
SELECT is(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')->'availableActions','[]'::JSONB,'review actions use the same owner-only policy outcome as the queue');
SELECT throws_ok($$SELECT public.record_workflow_decision_v2(
  p_company_id => '92000000-0000-4000-8000-000000000001',
  p_workflow_item_id => '96000000-0000-4000-8000-000000000002',
  p_decision => 'resolve',
  p_expected_version => public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002')->>'version',
  p_idempotency_key => 'approver-resolve-denied'
)$$,'42501','forbidden','resolve derives the current selected draft owner policy even when draftId is omitted');

SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.record_workflow_decision_v2(
  p_company_id => '92000000-0000-4000-8000-000000000001',
  p_workflow_item_id => '96000000-0000-4000-8000-000000000001',
  p_decision => 'resolve', p_expected_version => repeat('0',64),
  p_idempotency_key => 'outsider-real-item'
)$$,'42501','forbidden','an outsider cannot probe a real item through decision v2');
SELECT throws_ok($$SELECT public.record_workflow_decision_v2(
  p_company_id => '92000000-0000-4000-8000-000000000001',
  p_workflow_item_id => '96000000-0000-4000-8000-000000000099',
  p_decision => 'resolve', p_expected_version => repeat('0',64),
  p_idempotency_key => 'outsider-random-item'
)$$,'42501','forbidden','an outsider receives the same error for a random item identifier');
SELECT throws_ok($$SELECT public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{}')$$,'42501','forbidden','an outsider cannot read a cross-tenant queue');
SELECT throws_ok($$SELECT public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')$$,'42501','forbidden','an outsider cannot read a cross-tenant review');

SELECT set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(jsonb_array_length(public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{}')->'items'),5,'default queue includes active, blocked, and approved items');
SELECT ok(NOT (public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{}')->'items') @> '[{"id":"96000000-0000-4000-8000-000000000006"}]','default queue excludes resolved items');
SELECT is(jsonb_array_length(public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{"search":"COFFEE-READY"}')->'items'),1,'search uses the approved queue projection');
SELECT is(jsonb_array_length(public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{"priorities":[90],"sourceTypes":["fixture"],"ownerRoles":["approver"]}')->'items'),1,'queue filters combine with AND semantics');
SELECT throws_ok($$SELECT public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{"sort":{"key":"unknown","direction":"desc"}}')$$,'22023','invalid_queue_query','unsupported queue sorts fail validation');
SELECT ok((public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{"limit":2}')->'nextPage') IS NOT NULL,'a bounded first page returns a static snapshot cursor');
SELECT set_config('test.queue_page_one',public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{"limit":3}')::TEXT,true);
SELECT set_config('test.queue_page_two',public.list_workflow_queue_v1(
  '92000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'limit',3,
    'snapshotId',current_setting('test.queue_page_one')::JSONB #>> '{nextPage,snapshotId}',
    'position',(current_setting('test.queue_page_one')::JSONB #>> '{nextPage,position}')::INTEGER
  )
)::TEXT,true);
SELECT is((
  SELECT count(DISTINCT value->>'id')::INTEGER
  FROM (
    SELECT value FROM jsonb_array_elements(current_setting('test.queue_page_one')::JSONB->'items')
    UNION ALL
    SELECT value FROM jsonb_array_elements(current_setting('test.queue_page_two')::JSONB->'items')
  ) pages
),5,'static snapshot continuation has no skipped or duplicated queue item');
SELECT is((public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{}')->'items'->0->>'priority')::INTEGER,90,'default queue sort is deterministic priority descending');
SELECT ok((public.list_workflow_queue_v1('92000000-0000-4000-8000-000000000001','{}')->'items'->0->'nextActions') ? 'approve','ready queue work derives approve server-side');

SELECT is(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')->>'reviewState','ready','complete fresh review state is ready');
SELECT ok(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')->>'version' ~ '^[a-f0-9]{64}$','review returns a coherent version token');
SELECT ok((public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')->'availableActions') ? 'approve','ready review derives approve action');
SELECT is(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001') #>> '{recommendation,rationaleSummary}','[redacted]','review RPC sanitizes recommendation rationale scalar text');
SELECT ok(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')::TEXT !~* '(must-not-leak|rawToken|tokenHash|Bearer[[:space:]])','review projection recursively removes secrets and token text');
SELECT is(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001') #>> '{activity,items,0,actor,type}','agent','system_agent attribution maps to the public agent enum');
SELECT is(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001') #>> '{activity,items,0,summary}','[redacted]','review activity sanitizes summary scalar text');
SELECT ok(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')::TEXT !~* '(langsmith|trace)','public activity never contains internal trace data');
SELECT is(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000003')->>'reviewState','missing_context','an item without a draft graph is missing context');
SELECT is(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002')->>'reviewState','stale','stale selected context produces stale review state');
SELECT ok(NOT ((public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002')->'availableActions') ? 'approve'),'stale review does not derive approve');

SELECT throws_ok($$SELECT public.record_workflow_decision_v2('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000003','approve',(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000003')->>'version'),'missing-context-key','9a000000-0000-4000-8000-000000000099',NULL,true,NULL)$$,'P0002','draft_not_found','missing review graph cannot be approved');
RESET ROLE;
SELECT is((SELECT count(*)::INTEGER FROM public.workflow_decisions WHERE workflow_item_id='96000000-0000-4000-8000-000000000003'),0,'missing-context approval creates no decision');
SELECT throws_ok($$SELECT public.record_workflow_decision_v2('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002','approve',(public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000002')->>'version'),'stale-context-key','9a000000-0000-4000-8000-000000000002',NULL,true,NULL)$$,'55000','review_not_approvable','stale selected context cannot be approved');
SELECT is((SELECT count(*)::INTEGER FROM public.workflow_decisions WHERE workflow_item_id='96000000-0000-4000-8000-000000000002'),0,'stale-context approval creates no decision');
SELECT throws_ok($$SELECT public.record_workflow_decision_v2('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','approve',repeat('0',64),'bad-version-key','9a000000-0000-4000-8000-000000000001',NULL,true,NULL)$$,'40001','stale_version','stale expected version rejects before mutation');

SELECT set_config('test.ready_version',public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')->>'version',true);
SELECT throws_ok($$SELECT public.record_workflow_decision_v2(
  '92000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  'approve',current_setting('test.ready_version'),'older-draft-key',
  '9a000000-0000-4000-8000-000000000009',NULL,true,NULL
)$$,'40001','stale_draft','a current review version cannot be used to decide an older still-pending draft');
SELECT is((SELECT count(*)::INTEGER FROM public.workflow_decisions WHERE action_draft_id='9a000000-0000-4000-8000-000000000009'),0,'rejecting an older selected draft creates no decision');
SELECT set_config('test.ready_result',public.record_workflow_decision_v2('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','approve',current_setting('test.ready_version'),'ready-approval-key','9a000000-0000-4000-8000-000000000001','Password: hunter2-secret',true,NULL)::TEXT,true);
SELECT ok((current_setting('test.ready_result')::JSONB->'executionToken') IS NOT NULL,'first approval returns a one-time mock execution token');
SELECT is(current_setting('test.ready_result')::JSONB #>> '{decision,reason}','[redacted]','decision v2 response sanitizes reason scalar text');
SELECT is((SELECT count(*)::INTEGER FROM public.workflow_decisions WHERE workflow_item_id='96000000-0000-4000-8000-000000000001'),1,'approval creates one decision');
SELECT is((SELECT count(*)::INTEGER FROM public.workflow_audit_events WHERE workflow_item_id='96000000-0000-4000-8000-000000000001' AND event_type='decision_recorded'),1,'approval creates one public decision activity');
INSERT INTO public.workflow_action_drafts (
  id, company_id, workflow_run_id, workflow_item_id, recommendation_run_id,
  evidence_snapshot_id, action_type, status, payload, payload_hash, edit_policy,
  created_at, updated_at
) VALUES (
  '9a000000-0000-4000-8000-000000000010','92000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',
  '98000000-0000-4000-8000-000000000001','99000000-0000-4000-8000-000000000001',
  'execute_mock_purchase_order','pending_review','{"vendor":"Newer Safe Vendor","mode":"mock","lines":[]}',
  repeat('8',64),'{"editable":false,"requireReason":true,"immutablePaths":[],"arrayLengthPaths":[]}',
  now()+interval '1 minute',now()+interval '1 minute'
);
SELECT set_config('test.retry_result',public.record_workflow_decision_v2('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','approve',current_setting('test.ready_version'),'ready-approval-key','9a000000-0000-4000-8000-000000000001','Password: hunter2-secret',true,NULL)::TEXT,true);
SELECT ok((current_setting('test.retry_result')::JSONB->>'duplicate')::BOOLEAN,'identical decision retry returns the stored result after a newer draft appears');
SELECT ok(current_setting('test.retry_result')::JSONB->'executionToken' = 'null'::JSONB,'idempotent retry never stores or replays a raw token');
SELECT ok((current_setting('test.retry_result')::JSONB->>'needsTokenReissue')::BOOLEAN,'approval retry signals that a one-time token needs reissue');
SELECT is((SELECT count(*)::INTEGER FROM public.workflow_decisions WHERE workflow_item_id='96000000-0000-4000-8000-000000000001'),1,'idempotent retry creates no second decision');
SELECT throws_ok($$SELECT public.record_workflow_decision_v2('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001','approve',current_setting('test.ready_version'),'ready-approval-key','9a000000-0000-4000-8000-000000000001','changed request',true,NULL)$$,'23505','idempotency_key_reused','changed request cannot reuse a decision key');
SELECT is((SELECT value #>> '{priorState,itemStatus}' FROM jsonb_array_elements(public.list_workflow_activity_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')->'items') value WHERE value->>'type'='decision_recorded' LIMIT 1),'active','decision activity includes approved prior item state');
SELECT is((SELECT value #>> '{resultState,itemStatus}' FROM jsonb_array_elements(public.list_workflow_activity_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')->'items') value WHERE value->>'type'='decision_recorded' LIMIT 1),'approved','decision activity includes approved result item state');
SELECT is((SELECT value ->> 'reason' FROM jsonb_array_elements(public.list_workflow_activity_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')->'items') value WHERE value->>'type'='decision_recorded' LIMIT 1),'[redacted]','activity RPC sanitizes decision reason scalar text');
SELECT set_config('test.activity_page_one',public.list_workflow_activity_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001',1)::TEXT,true);
SELECT set_config('test.activity_page_two',public.list_workflow_activity_v1(
  '92000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  1,
  (current_setting('test.activity_page_one')::JSONB #>> '{nextPage,beforeCreatedAt}')::TIMESTAMPTZ,
  (current_setting('test.activity_page_one')::JSONB #>> '{nextPage,beforeId}')::UUID
)::TEXT,true);
SELECT ok(
  current_setting('test.activity_page_one')::JSONB #>> '{items,0,id}'
    <> current_setting('test.activity_page_two')::JSONB #>> '{items,0,id}',
  'activity continuation does not duplicate the boundary event'
);
SELECT ok(
  ROW(
    (current_setting('test.activity_page_one')::JSONB #>> '{items,0,createdAt}')::TIMESTAMPTZ,
    (current_setting('test.activity_page_one')::JSONB #>> '{items,0,id}')::UUID
  ) > ROW(
    (current_setting('test.activity_page_two')::JSONB #>> '{items,0,createdAt}')::TIMESTAMPTZ,
    (current_setting('test.activity_page_two')::JSONB #>> '{items,0,id}')::UUID
  ),
  'activity pages preserve descending created-at and identifier order'
);
SELECT is((SELECT count(*)::INTEGER FROM public.workflow_action_attempts WHERE workflow_item_id='96000000-0000-4000-8000-000000000001'),0,'approval performs no live or mock execution');

SELECT set_config('test.resolve_version',public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000004')->>'version',true);
SELECT set_config('test.resolve_result',public.record_workflow_decision_v2(
  p_company_id => '92000000-0000-4000-8000-000000000001',
  p_workflow_item_id => '96000000-0000-4000-8000-000000000004',
  p_decision => 'resolve', p_expected_version => current_setting('test.resolve_version'),
  p_idempotency_key => 'resolve-item-key', p_reason => 'Handled manually'
)::TEXT,true);
SELECT is(current_setting('test.resolve_result')::JSONB #>> '{item,status}','resolved','resolve closes active or blocked work without a draft');
SELECT ok((public.record_workflow_decision_v2(
  p_company_id => '92000000-0000-4000-8000-000000000001',
  p_workflow_item_id => '96000000-0000-4000-8000-000000000004',
  p_decision => 'resolve', p_expected_version => current_setting('test.resolve_version'),
  p_idempotency_key => 'resolve-item-key', p_reason => 'Handled manually'
)->>'duplicate')::BOOLEAN,'resolve retry is idempotent and draftId remains optional');
SELECT is((SELECT count(*)::INTEGER FROM public.workflow_decisions WHERE workflow_item_id='96000000-0000-4000-8000-000000000004'),1,'resolve retry creates one decision total');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE public.workflow_evidence_snapshots SET evidence='[]' WHERE id='99000000-0000-4000-8000-000000000001'$$,'42501',NULL,'authenticated callers cannot mutate evidence history');
SELECT throws_ok($$DELETE FROM public.workflow_audit_events WHERE id='9b000000-0000-4000-8000-000000000001'$$,'42501',NULL,'authenticated callers cannot delete audit history');
RESET ROLE;
SELECT throws_ok($$DELETE FROM public.workflow_evidence_snapshots WHERE id='99000000-0000-4000-8000-000000000001'$$,'55000','immutable_workflow_history','privileged point deletion cannot remove evidence history');
SELECT throws_ok($$DELETE FROM public.workflow_decisions WHERE workflow_item_id='96000000-0000-4000-8000-000000000001'$$,'55000','immutable_workflow_history','privileged point deletion cannot remove decision history');
SELECT throws_ok($$DELETE FROM public.workflow_decision_outcomes WHERE workflow_item_id='96000000-0000-4000-8000-000000000001'$$,'55000','immutable_workflow_history','privileged point deletion cannot remove decision outcomes');
SELECT throws_ok($$DELETE FROM public.workflow_audit_events WHERE id='9b000000-0000-4000-8000-000000000001'$$,'55000','immutable_workflow_history','privileged point deletion cannot remove audit history');
SELECT throws_ok($$DELETE FROM public.workflow_items WHERE id='96000000-0000-4000-8000-000000000001'$$,'55000','immutable_workflow_history','privileged point deletion cannot erase history through an item root');
SELECT throws_ok($$DELETE FROM public.workflow_runs WHERE id='94000000-0000-4000-8000-000000000001'$$,'55000','immutable_workflow_history','privileged point deletion cannot erase history through a run root');
SELECT ok(
  EXISTS(SELECT 1 FROM public.workflow_runs WHERE id='94000000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.workflow_items WHERE id='96000000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.workflow_context_packets WHERE id='97000000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.workflow_evidence_snapshots WHERE id='99000000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.workflow_decisions WHERE workflow_item_id='96000000-0000-4000-8000-000000000001')
  AND EXISTS(SELECT 1 FROM public.workflow_decision_outcomes WHERE workflow_item_id='96000000-0000-4000-8000-000000000001'),
  'blocked item and run point deletes leave the complete immutable graph intact'
);
SELECT ok(current_setting('test.ready_version') <> (public.get_workflow_review_v1('92000000-0000-4000-8000-000000000001','96000000-0000-4000-8000-000000000001')->>'version'),'decision state changes the coherent review version');
SELECT ok(NOT has_function_privilege('authenticated','workflow_private.workflow_review_version(uuid,uuid)','EXECUTE'),'authenticated callers cannot bypass the controlled review projection');

-- Privileged tenant retention cleanup must be able to cascade through every
-- append-only history table; immutability applies to UPDATE, not retention DELETE.
INSERT INTO public.agent_workflows(id,company_id,workflow_key,workflow_type,name,version,status,spec)
VALUES('c1000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','cascade-workflow','cascade_test','Cascade workflow','1.0.0','active','{}');
INSERT INTO public.workflow_runs(id,company_id,workflow_id,workflow_type,status,input)
VALUES('c2000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','cascade_test','waiting_for_approval','{}');
INSERT INTO public.workflow_events(id,company_id,workflow_run_id,workflow_id,event_key,event_type,origin,source_ref,payload,freshness_state,validation_status,validation_result)
VALUES('c3000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','cascade-event','cascade_test','manual','{}','{}','fresh','pass','{}');
INSERT INTO public.workflow_items(id,company_id,workflow_run_id,workflow_event_id,workflow_id,item_key,item_type,title,status,priority,related_records)
VALUES('c4000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','cascade-item','cascade_test','Cascade item','active',1,'{}');
INSERT INTO public.workflow_context_packets(id,company_id,workflow_run_id,workflow_item_id,sources,facts,memory_refs,freshness_state,warnings)
VALUES('c5000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','[]','{}','[]','fresh','[]');
INSERT INTO public.workflow_recommendation_runs(id,company_id,workflow_run_id,workflow_item_id,context_packet_id,status,rationale_summary,warning_state,warnings,confidence,freshness_state,input,output)
VALUES('c6000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c5000000-0000-4000-8000-000000000001','ready_for_review','Cascade cleanup.','pass','[]',1,'fresh','{}','{}');
INSERT INTO public.workflow_evidence_snapshots(id,company_id,workflow_run_id,workflow_item_id,recommendation_run_id,source_refs,assumptions,warnings,evidence)
VALUES('c7000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001','[]','[]','[]','[]');
INSERT INTO public.workflow_action_drafts(id,company_id,workflow_run_id,workflow_item_id,recommendation_run_id,evidence_snapshot_id,action_type,status,payload,payload_hash)
VALUES('c8000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','cascade_test','pending_review','{}',repeat('c',64));
INSERT INTO public.workflow_decisions(id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision,actor_type,decided_by,reason,warnings_acknowledged)
VALUES('c9000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001','reject','user','91000000-0000-4000-8000-000000000004','Cascade test',false);
INSERT INTO public.workflow_decision_outcomes(decision_id,company_id,workflow_item_id,expected_version,prior_state,result_state)
VALUES('c9000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','c4000000-0000-4000-8000-000000000001',repeat('d',64),'{"itemStatus":"active","draftStatus":"pending_review"}','{"itemStatus":"rejected","draftStatus":"rejected"}');
INSERT INTO public.workflow_audit_events(id,company_id,actor_type,actor_id,workflow_run_id,workflow_item_id,event_type,summary,payload,trace)
VALUES('cb000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','user','91000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','decision_recorded','Cascade test.','{}','{}');
SELECT lives_ok($$DELETE FROM auth.users WHERE id='91000000-0000-4000-8000-000000000004'$$,'auth-user deletion may apply database-owned null cascades to immutable history');
SELECT ok((SELECT decided_by IS NULL FROM public.workflow_decisions WHERE id='c9000000-0000-4000-8000-000000000001'),'auth-user cascade clears the decision actor without opening direct updates');
SELECT ok((SELECT actor_id IS NULL FROM public.workflow_audit_events WHERE id='cb000000-0000-4000-8000-000000000001'),'auth-user cascade clears the audit actor without opening direct updates');
SELECT lives_ok($$DELETE FROM public.companies WHERE id='92000000-0000-4000-8000-000000000002'$$,'privileged company deletion cascades through immutable workflow history');
SELECT is((SELECT count(*)::INTEGER FROM public.companies WHERE id='92000000-0000-4000-8000-000000000002'),0,'tenant cascade removes the company after history cleanup');

SELECT * FROM finish();
ROLLBACK;
