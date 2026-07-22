BEGIN;
SELECT plan(130);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('a1000000-0000-4000-8000-000000000001','authenticated','authenticated','runtime-owner@example.test','',now(),'{}','{}',now(),now()),
  ('a1000000-0000-4000-8000-000000000002','authenticated','authenticated','other-viewer@example.test','',now(),'{}','{}',now(),now()),
  ('a1000000-0000-4000-8000-000000000003','authenticated','authenticated','runtime-member@example.test','',now(),'{}','{}',now(),now());

INSERT INTO public.companies(id,name,created_by) VALUES
  ('a2000000-0000-4000-8000-000000000001','Runtime Company','a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002','Other Company','a1000000-0000-4000-8000-000000000002');
INSERT INTO public.company_memberships(company_id,user_id,role) VALUES
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','owner'),
  ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003','member'),
  ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','viewer');

INSERT INTO public.agent_workflows(
  id,company_id,workflow_key,workflow_type,name,version,status,spec,compile_result,created_by,updated_by
) VALUES (
  'a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
  'controlled_runtime_test','runtime_test','Controlled runtime test','1.0.0','draft','{}','{"ok":true}',
  'a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.workflow_binding_snapshots(
  id,company_id,workflow_id,manifest_hash,grant_digest,created_by
) VALUES (
  'a3100000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',
  repeat('8',64),repeat('9',64),'a1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.workflow_runs(id,company_id,workflow_id,workflow_type,status,input,started_by)
VALUES('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','runtime_test','waiting_for_approval','{}','a1000000-0000-4000-8000-000000000001');
INSERT INTO public.workflow_events(
  id,company_id,workflow_run_id,workflow_id,event_key,event_type,origin,source_ref,payload,freshness_state,validation_status,validation_result
) VALUES (
  'a5000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001','runtime-event','runtime_test','fixture','{}','{}','fresh','pass','{}'
);
INSERT INTO public.workflow_items(
  id,company_id,workflow_run_id,workflow_event_id,workflow_id,item_key,item_type,title,status,priority,related_records
) VALUES (
  'a6000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','runtime-item','runtime_review','Runtime item','active',50,'{}'
);
INSERT INTO public.workflow_context_packets(
  id,company_id,workflow_run_id,workflow_item_id,sources,facts,memory_refs,freshness_state,warnings
) VALUES (
  'a7000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001','[]','{}','[]','fresh','[]'
);
INSERT INTO public.workflow_recommendation_runs(
  id,company_id,workflow_run_id,workflow_item_id,context_packet_id,status,rationale_summary,warning_state,warnings,confidence,freshness_state,input,output,langsmith_trace_id,langsmith_run_id
) VALUES (
  'a8000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000001','ready_for_review','Safe summary','pass','[]',0.8,'fresh','{}','{}','trace-runtime-safe','run-runtime-safe'
);
INSERT INTO public.workflow_evidence_snapshots(
  id,company_id,workflow_run_id,workflow_item_id,recommendation_run_id,source_refs,assumptions,warnings,evidence
) VALUES (
  'a9000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','[{"source":"sandbox-fixture"}]','[]','[]','[]'
);
INSERT INTO public.workflow_action_drafts(
  id,company_id,workflow_run_id,workflow_item_id,recommendation_run_id,evidence_snapshot_id,action_type,status,payload,payload_hash
) VALUES (
  'aa000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001','a8000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000001',
  'runtime_action','approved','{}',encode(extensions.digest(convert_to('{}'::JSONB::TEXT,'UTF8'),'sha256'),'hex')
);
INSERT INTO public.workflow_decisions(
  id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision,actor_type,decided_by,warnings_acknowledged
) VALUES (
  'ab000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','approve','user','a1000000-0000-4000-8000-000000000001',true
);
INSERT INTO public.workflow_execution_tokens(
  id,company_id,action_draft_id,action_type,token_hash,payload_hash,expires_at,created_by
) VALUES (
  'ac000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001',
  'runtime_action',encode(extensions.digest(convert_to('runtime-token','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to('{}'::JSONB::TEXT,'UTF8'),'sha256'),'hex'),now()+interval '1 hour','a1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.workflow_execution_tokens(
  id,company_id,action_draft_id,action_type,token_hash,payload_hash,expires_at,consumed_at,created_by
) VALUES (
  'ac000000-0000-4000-8000-000000000099','a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001',
  'runtime_action',repeat('d',64),encode(extensions.digest(convert_to('{}'::JSONB::TEXT,'UTF8'),'sha256'),'hex'),now()+interval '1 hour',now(),'a1000000-0000-4000-8000-000000000001'
);

INSERT INTO public.agent_action_definitions(
  action_key,version,capability_version_id,input_schema,output_schema,allowed_modes,timeout_ms,
  retry_class,idempotency_scope,audit_classification
) SELECT 'runtime_action','1.0.0',version.id,'{"type":"object"}','{"type":"object"}',ARRAY['mock'],1000,'never','action','internal'
FROM public.capability_definition_versions version
JOIN public.capability_definitions capability ON capability.id=version.capability_definition_id
WHERE capability.capability_key='procurement.purchase-order.mock-execute' AND version.version='1.0.0';

SELECT ok((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid = ANY(ARRAY[
  'public.agent_action_definitions'::REGCLASS,'public.agent_tool_definitions'::REGCLASS,
  'public.agent_execution_receipts'::REGCLASS,'public.agent_runtime_states'::REGCLASS,
  'public.agent_lifecycle_events'::REGCLASS,'public.agent_feedback'::REGCLASS,
  'public.agent_memory_candidates'::REGCLASS,'public.agent_follow_ups'::REGCLASS,
  'public.agent_escalations'::REGCLASS,'public.agent_monitoring_events'::REGCLASS,
  'public.agent_evaluation_cases'::REGCLASS,
  'public.agent_evaluation_runs'::REGCLASS,'public.agent_evaluation_outcome_labels'::REGCLASS,
  'public.agent_promotion_checkpoints'::REGCLASS
])), 'all cycle 0.0.5 public tables enable RLS immediately');
SELECT ok(NOT has_table_privilege('authenticated','public.agent_memory_candidates','SELECT'),'raw memory candidates are not directly readable');
SELECT ok(NOT has_table_privilege('authenticated','public.agent_execution_receipts','SELECT'),'raw execution receipts are not directly readable');
SELECT ok(NOT has_table_privilege('authenticated','public.agent_feedback','SELECT'),'raw feedback text is not directly selectable; callers use controlled projections');
SELECT ok(NOT has_table_privilege('authenticated','public.agent_action_definitions','INSERT'),'clients cannot register actions');
SELECT ok(NOT has_table_privilege('authenticated','public.agent_monitoring_events','INSERT'),'clients cannot forge monitoring history');
SELECT ok(NOT has_function_privilege('authenticated','public.record_agent_readiness_v1(uuid,uuid,bigint,text,jsonb,uuid,text)','EXECUTE'),'clients cannot forge readiness with an empty blocker list');
SELECT ok(has_function_privilege('authenticated','public.record_agent_test_evaluation_v1(uuid,uuid,bigint,uuid,uuid,jsonb,text,text)','EXECUTE'),'managers use the evidence-derived Sandbox evaluation boundary');
SELECT ok(has_function_privilege('authenticated','public.record_agent_feedback_v1(uuid,uuid,jsonb)','EXECUTE'),'authenticated callers receive only the controlled feedback RPC');
SELECT ok(NOT has_function_privilege('authenticated','workflow_private.claim_due_agent_follow_ups(text,integer,integer,timestamp with time zone)','EXECUTE'),'authenticated callers cannot claim worker jobs');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid='workflow_private.record_agent_feedback_payload(uuid,uuid,jsonb)'::REGPROCEDURE),true,'private feedback mutation is security definer');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='workflow_private.record_agent_feedback_payload(uuid,uuid,jsonb)'::REGPROCEDURE),'private feedback mutation has an empty search path');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.has_company_role(uuid,text)'::REGPROCEDURE),'shared company-role checks use an explicit empty search path');

SELECT throws_ok($$INSERT INTO public.agent_action_definitions(action_key,version,capability_version_id,input_schema,output_schema,allowed_modes,timeout_ms,retry_class,idempotency_scope,audit_classification) SELECT 'bad_modes','1.0.0',id,'{}','{}',ARRAY['live','invented'],1000,'never','request','internal' FROM public.capability_definition_versions LIMIT 1$$,'23514',NULL,'unknown execution modes cannot be registered');
SELECT throws_ok($$INSERT INTO public.agent_tool_definitions(tool_key,version,capability_version_id,access_class,allowed_modes,input_schema,output_schema) SELECT 'read_live','1.0.0',id,'read',ARRAY['live'],'{}','{}' FROM public.capability_definition_versions LIMIT 1$$,'23514',NULL,'read tools cannot register live execution');

INSERT INTO public.workflow_action_attempts(
  id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,
  idempotency_key,action_type,mode,status,request_payload,result_payload,retry_class,effect_state,
  request_hash,reconciliation_required
) VALUES (
  'ad000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000099','unknown-result','runtime_action','live','unknown','{}','{}','reconcile_first','unknown',repeat('c',64),true
);
SELECT is((SELECT status FROM public.workflow_action_attempts WHERE id='ad000000-0000-4000-8000-000000000001'),'unknown','timeout-after-write can be persisted as outcome unknown');
INSERT INTO public.agent_execution_receipts(
  id,company_id,action_attempt_id,status,effect_state,failure_class,request_hash
) VALUES (
  'ae000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000001',
  'reconciliation_required','unknown','reconciliation_required',repeat('c',64)
);
SELECT is((SELECT status FROM public.agent_execution_receipts WHERE id='ae000000-0000-4000-8000-000000000001'),'reconciliation_required','receipt records reconciliation as an explicit state');
SELECT throws_ok($$UPDATE public.agent_execution_receipts SET status='failed' WHERE id='ae000000-0000-4000-8000-000000000001'$$,'55000','agent_runtime_history_immutable','execution receipts are immutable');
SELECT throws_ok($$INSERT INTO public.agent_execution_receipts(company_id,action_attempt_id,receipt_sequence,status,effect_state,failure_class,request_hash) VALUES('a2000000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-000000000001',2,'unknown','unknown','outcome_unknown',repeat('d',64))$$,'23503',NULL,'receipt tenant references cannot cross companies');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(public.record_agent_test_evaluation_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','[]','1.0.0','Sandbox evidence passed')->>'lifecycleState','ready','readiness is derived from a durable Sandbox review and evaluation');
SELECT ok((SELECT case_key LIKE 'sandbox-review-a3000000-0000-4000-8000-000000000001-%' FROM public.agent_evaluation_cases WHERE company_id='a2000000-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 1),'evaluation fixtures are keyed to the exact workflow and durable dataset digest');
SELECT set_config('test.evaluation_review_version',(SELECT recommendation_version FROM public.agent_evaluation_runs WHERE company_id='a2000000-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 1),true);
SELECT is(current_setting('test.evaluation_review_version'),public.get_workflow_review_v1('a2000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001')->>'version','evaluation records the exact review version that produced the recommendation');
SELECT is((SELECT safe_trace_ids FROM public.agent_evaluation_runs WHERE company_id='a2000000-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 1),'["trace-runtime-safe","run-runtime-safe"]'::JSONB,'evaluation persists only bounded safe trace identifiers');
SELECT throws_ok($$SELECT public.record_agent_test_evaluation_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',1,'a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','[]','1.0.0','Stale Sandbox result')$$,'P0001','stale_agent_state','stale readiness returns one application conflict instead of a retryable transaction failure');
SELECT throws_ok($$SELECT public.transition_agent_lifecycle_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','activate',1,'Stale activation')$$,'P0001','stale_agent_state','stale lifecycle transitions return one application conflict instead of a retry storm');
SELECT is(public.transition_agent_lifecycle_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','activate',2,'Activate tested agent')->>'lifecycleState','active','only a ready agent activates');
SELECT throws_ok($$SELECT public.activate_agent_workflow('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a3100000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001')$$,'55000','lifecycle_transition_requires_expected_version','legacy activation cannot bypass caller-observed lifecycle versions');
SELECT throws_ok($$SELECT public.deactivate_agent_workflow('a2000000-0000-4000-8000-000000000001','controlled_runtime_test','a3000000-0000-4000-8000-000000000001')$$,'55000','lifecycle_transition_requires_expected_version','legacy deactivation cannot desynchronize runtime lifecycle state');
SELECT set_config('test.execution',public.execute_mock_workflow_action_controlled(
  'a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001',
  'ab000000-0000-4000-8000-000000000001','runtime-token','api:ad000000-0000-4000-8000-000000000010',
  '{}'::JSONB,repeat('7',64),'api'
)::TEXT,true);
SELECT ok((current_setting('test.execution')::JSONB #>> '{attempt,action_definition_id}') IS NOT NULL,'shipped execution resolves an exact registered action version');
RESET ROLE;
SELECT is((SELECT status FROM public.agent_execution_receipts WHERE action_attempt_id=(current_setting('test.execution')::JSONB #>> '{attempt,id}')::UUID),'succeeded','shipped execution writes a durable receipt transactionally');
SELECT is((SELECT count(*)::INTEGER FROM public.workflow_action_attempts WHERE idempotency_key='api:ad000000-0000-4000-8000-000000000010'),1,'registered execution preserves durable idempotency');
UPDATE public.workflow_runs SET status='waiting_for_approval',completed_at=NULL
WHERE id='a4000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('test.followup_one',public.schedule_agent_follow_up_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'companyId','a2000000-0000-4000-8000-000000000001','workflowId','a3000000-0000-4000-8000-000000000001',
    'workflowRunId','a4000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001',
    'actionAttemptId',NULL,'condition',jsonb_build_object('type','overdue'),'dueAt',now()-interval '1 minute',
    'severity','high','ruleVersion','1.0.0','recurrencePolicy','reopen','maxAttempts',5
  )
)::TEXT,true);
SELECT ok((current_setting('test.followup_one')::JSONB->>'id') IS NOT NULL,'authorized admins can schedule bounded follow-up work');
SELECT is(public.schedule_agent_follow_up_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','workflowId','a3000000-0000-4000-8000-000000000001','workflowRunId','a4000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','actionAttemptId',NULL,'condition',jsonb_build_object('type','overdue'),'dueAt',now()-interval '1 minute','severity','high','ruleVersion','1.0.0','recurrencePolicy','reopen','maxAttempts',5)
)->>'id',current_setting('test.followup_one')::JSONB->>'id','one open follow-up condition is idempotent');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('test.lease_id',(SELECT "leaseId"::TEXT FROM workflow_private.claim_due_agent_follow_ups('worker-1',10,60,now()) LIMIT 1),true);
SELECT ok(current_setting('test.lease_id') IS NOT NULL,'worker atomically claims one due follow-up');
SELECT is((SELECT count(*)::INTEGER FROM workflow_private.claim_due_agent_follow_ups('worker-2',10,60,now())),0,'leased follow-up is skipped by concurrent workers');
SELECT is(workflow_private.complete_agent_follow_up_claim('worker-1',current_setting('test.lease_id')::UUID,jsonb_build_object('qualifies',true,'activeKey',repeat('f',64),'reason','overdue_detected','evaluatedAt',now())) #>> '{escalation,status}','open','qualifying follow-up creates an active escalation');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_escalations WHERE status='active'),1,'active escalation uniqueness suppresses duplicates');
UPDATE public.agent_follow_ups SET available_at=now()-interval '1 second' WHERE id=(current_setting('test.followup_one')::JSONB->>'id')::UUID;
SELECT set_config('test.lease_id',(SELECT "leaseId"::TEXT FROM workflow_private.claim_due_agent_follow_ups('worker-1',10,60,now()) LIMIT 1),true);
SELECT workflow_private.complete_agent_follow_up_claim('worker-1',current_setting('test.lease_id')::UUID,jsonb_build_object('qualifies',false,'activeKey',repeat('f',64),'reason','source_resolved','evaluatedAt',now()));
SELECT is((SELECT status FROM public.agent_escalations WHERE active_key=repeat('f',64)),'resolved','resolving the condition closes its active escalation');
SELECT is(
  (SELECT string_agg(event_type,',' ORDER BY event_sequence) FROM public.agent_monitoring_events
   WHERE follow_up_id=(current_setting('test.followup_one')::JSONB->>'id')::UUID),
  'scheduled,deduplicated,claimed,escalated,claimed,resolved',
  'monitoring retains the complete ordered activity history'
);
SELECT throws_ok(
  $$UPDATE public.agent_monitoring_events SET reason='tampered' WHERE follow_up_id=(current_setting('test.followup_one')::JSONB->>'id')::UUID$$,
  '55000','agent_runtime_history_immutable','monitoring activity history is immutable'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('test.followup_reopened',public.schedule_agent_follow_up_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','workflowId','a3000000-0000-4000-8000-000000000001','workflowRunId','a4000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','actionAttemptId',NULL,'condition',jsonb_build_object('type','overdue'),'dueAt',now()-interval '1 minute','severity','high','ruleVersion','1.0.0','recurrencePolicy','reopen','maxAttempts',5)
)::TEXT,true);
SELECT is(current_setting('test.followup_reopened')::JSONB->>'id',current_setting('test.followup_one')::JSONB->>'id','reopen keeps the durable follow-up identity');
SELECT is((current_setting('test.followup_reopened')::JSONB->>'occurrence')::INTEGER,2,'reopen explicitly advances the occurrence');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_monitoring_events WHERE follow_up_id=(current_setting('test.followup_one')::JSONB->>'id')::UUID AND event_type='reopened' AND occurrence=2),1,'reopen is retained as explicit history');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('test.lease_id',(SELECT "leaseId"::TEXT FROM workflow_private.claim_due_agent_follow_ups('worker-1',10,60,now()) WHERE "followUp"->>'id'=current_setting('test.followup_reopened')::JSONB->>'id' LIMIT 1),true);
SELECT workflow_private.complete_agent_follow_up_claim('worker-1',current_setting('test.lease_id')::UUID,jsonb_build_object('qualifies',false,'activeKey',repeat('f',64),'reason','source_resolved','evaluatedAt',now()));

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('test.followup_new_occurrence',public.schedule_agent_follow_up_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','workflowId','a3000000-0000-4000-8000-000000000001','workflowRunId','a4000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','actionAttemptId',NULL,'condition',jsonb_build_object('type','overdue'),'dueAt',now()+interval '1 hour','severity','high','ruleVersion','1.0.0','recurrencePolicy','new_occurrence','maxAttempts',5)
)::TEXT,true);
SELECT isnt(current_setting('test.followup_new_occurrence')::JSONB->>'id',current_setting('test.followup_one')::JSONB->>'id','new occurrence creates a distinct durable follow-up');
SELECT is((current_setting('test.followup_new_occurrence')::JSONB->>'occurrence')::INTEGER,3,'new occurrence advances from the last closed occurrence');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_monitoring_events WHERE follow_up_id=(current_setting('test.followup_new_occurrence')::JSONB->>'id')::UUID AND event_type='new_occurrence' AND occurrence=3),1,'new occurrence is retained as explicit history');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
UPDATE public.agent_follow_ups SET due_at=now()-interval '1 minute',available_at=now()-interval '1 minute'
WHERE id=(current_setting('test.followup_new_occurrence')::JSONB->>'id')::UUID;
SELECT set_config('test.lease_id',(SELECT "leaseId"::TEXT FROM workflow_private.claim_due_agent_follow_ups('worker-1',10,60,now()) WHERE "followUp"->>'id'=current_setting('test.followup_new_occurrence')::JSONB->>'id' LIMIT 1),true);
SELECT is(workflow_private.complete_agent_follow_up_claim('worker-1',current_setting('test.lease_id')::UUID,jsonb_build_object('qualifies',true,'activeKey',repeat('3',64),'reason','overdue_detected','evaluatedAt',now())) #>> '{escalation,status}','open','new occurrence can open its own escalation');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_escalations WHERE status='active'),1,'the occurrence begins with exactly one active escalation');
UPDATE public.agent_follow_ups SET available_at=now()-interval '1 minute'
WHERE id=(current_setting('test.followup_new_occurrence')::JSONB->>'id')::UUID;
SELECT set_config('test.lease_id',(SELECT "leaseId"::TEXT FROM workflow_private.claim_due_agent_follow_ups('worker-1',10,60,now()) WHERE "followUp"->>'id'=current_setting('test.followup_new_occurrence')::JSONB->>'id' LIMIT 1),true);
SELECT workflow_private.fail_agent_follow_up_claim('worker-1',current_setting('test.lease_id')::UUID,true,'temporary_provider_error');
SELECT is((SELECT status FROM public.agent_follow_ups WHERE id=(current_setting('test.followup_new_occurrence')::JSONB->>'id')::UUID),'scheduled','retryable monitoring failures return the occurrence to the schedule');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_monitoring_events WHERE follow_up_id=(current_setting('test.followup_new_occurrence')::JSONB->>'id')::UUID AND event_type='retry_scheduled'),1,'retry scheduling is retained in activity history');
UPDATE public.agent_follow_ups SET available_at=now()-interval '1 minute'
WHERE id=(current_setting('test.followup_new_occurrence')::JSONB->>'id')::UUID;
SELECT set_config('test.lease_id',(SELECT "leaseId"::TEXT FROM workflow_private.claim_due_agent_follow_ups('worker-1',10,60,now()) WHERE "followUp"->>'id'=current_setting('test.followup_new_occurrence')::JSONB->>'id' LIMIT 1),true);
SELECT workflow_private.fail_agent_follow_up_claim('worker-1',current_setting('test.lease_id')::UUID,false,'permanent_provider_error');
SELECT is((SELECT status FROM public.agent_follow_ups WHERE id=(current_setting('test.followup_new_occurrence')::JSONB->>'id')::UUID),'dead_letter','non-retryable monitoring failures close the occurrence as dead letter');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_monitoring_events WHERE follow_up_id=(current_setting('test.followup_new_occurrence')::JSONB->>'id')::UUID AND event_type='dead_letter'),1,'dead-letter closure is retained in activity history');
SELECT is((SELECT status FROM public.agent_escalations WHERE active_key=repeat('3',64)),'suppressed','dead-letter transactionally suppresses the occurrence escalation');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_escalations WHERE status='active'),0,'dead-letter leaves no active escalation behind');
SELECT is(
  (SELECT string_agg(event_type,',' ORDER BY event_sequence) FROM public.agent_monitoring_events
   WHERE follow_up_id=(current_setting('test.followup_new_occurrence')::JSONB->>'id')::UUID),
  'new_occurrence,claimed,escalated,claimed,retry_scheduled,claimed,suppressed,dead_letter',
  'dead-letter history records escalation suppression before follow-up closure'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('test.followup_after_dead_letter',public.schedule_agent_follow_up_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','workflowId','a3000000-0000-4000-8000-000000000001','workflowRunId','a4000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','actionAttemptId',NULL,'condition',jsonb_build_object('type','overdue'),'dueAt',now()-interval '1 minute','severity','high','ruleVersion','1.0.0','recurrencePolicy','new_occurrence','maxAttempts',5)
)::TEXT,true);
SELECT isnt(current_setting('test.followup_after_dead_letter')::JSONB->>'id',current_setting('test.followup_new_occurrence')::JSONB->>'id','a later occurrence starts with a distinct follow-up after dead-letter');
SELECT is((current_setting('test.followup_after_dead_letter')::JSONB->>'occurrence')::INTEGER,4,'the post-dead-letter occurrence advances monotonically');

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('test.lease_id',(SELECT "leaseId"::TEXT FROM workflow_private.claim_due_agent_follow_ups('worker-1',10,60,now()) WHERE "followUp"->>'id'=current_setting('test.followup_after_dead_letter')::JSONB->>'id' LIMIT 1),true);
SELECT is(workflow_private.complete_agent_follow_up_claim('worker-1',current_setting('test.lease_id')::UUID,jsonb_build_object('qualifies',true,'activeKey',repeat('4',64),'reason','overdue_detected','evaluatedAt',now())) #>> '{escalation,status}','open','the later occurrence can escalate normally');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_escalations escalation
  JOIN public.agent_follow_ups follow_up ON follow_up.id=escalation.follow_up_id AND follow_up.company_id=escalation.company_id
  WHERE escalation.status='active' AND follow_up.workflow_item_id='a6000000-0000-4000-8000-000000000001'
    AND follow_up.condition_type='overdue' AND follow_up.rule_version='1.0.0'),1,
  're-escalation preserves at most one active escalation for the source condition');

RESET ROLE;
INSERT INTO public.workflow_resume_outbox(company_id,workflow_run_id,node_key,event_type,dedupe_key)
VALUES('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','resume_test','continue_run',repeat('1',64));
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(public.transition_agent_lifecycle_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','pause',3,'Pause agent')->>'lifecycleState','paused','active agents pause through an explicit versioned transition');
RESET ROLE;
SELECT is((SELECT status FROM public.workflow_resume_outbox WHERE dedupe_key=repeat('1',64)),'failed','pausing an agent blocks work queued before the transition');
SELECT throws_ok($$INSERT INTO public.workflow_resume_outbox(company_id,workflow_run_id,node_key,event_type,dedupe_key) VALUES('a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','blocked_resume','continue_run',repeat('2',64))$$,'55000','agent_lifecycle_blocks_queued_work','paused agents reject newly queued resume work');
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($$INSERT INTO public.workflow_action_attempts(
  id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,
  idempotency_key,action_type,mode,status,request_payload,result_payload
) VALUES (
  'ad000000-0000-4000-8000-000000000020','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001','paused-attempt','runtime_action','mock','succeeded','{}','{}'
)$$,'55000','agent_not_active','a pause immediately blocks an already-approved action at execution time');
RESET ROLE;
UPDATE public.agent_runtime_states SET lifecycle_state='disabled'
WHERE company_id='a2000000-0000-4000-8000-000000000001' AND workflow_id='a3000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($$INSERT INTO public.workflow_action_attempts(
  id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,
  idempotency_key,action_type,mode,status,request_payload,result_payload
) VALUES (
  'ad000000-0000-4000-8000-000000000021','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',
  'ac000000-0000-4000-8000-000000000001','disabled-attempt','runtime_action','mock','succeeded','{}','{}'
)$$,'55000','agent_not_active','a disable immediately blocks an already-approved action at execution time');
RESET ROLE;
UPDATE public.agent_runtime_states SET lifecycle_state='paused'
WHERE company_id='a2000000-0000-4000-8000-000000000001' AND workflow_id='a3000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.transition_agent_lifecycle_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','resume',4,'Resume without refresh')$$,'55000','agent_readiness_stale','resume blocks readiness computed before the pause');
SELECT is(public.record_agent_test_evaluation_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',4,'a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','[]','1.0.0','Refresh Sandbox readiness while paused')->>'lifecycleState','paused','readiness can refresh without unpausing the agent');
SELECT is(public.transition_agent_lifecycle_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','resume',5,'Resume after readiness refresh')->>'lifecycleState','active','resume succeeds after current readiness and bindings are revalidated');
SELECT public.transition_agent_lifecycle_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','pause',6,'Pause before promotion gate');

SELECT set_config('test.review_version',public.get_workflow_review_v1('a2000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001')->>'version',true);
SELECT throws_ok($$SELECT public.record_agent_feedback_v1('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','accepted','correction',NULL,'reason','github_pat_abcdefghijklmnopqrstuvwxyz1234567890','outcome',NULL,'clientSurface','api'))$$,'22023','invalid_agent_feedback','feedback rejects GitHub fine-grained tokens');
SELECT throws_ok($$SELECT public.record_agent_feedback_v1('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','accepted','correction',NULL,'reason','xox' || 'b-1234567890-abcdefghijklmnop','outcome',NULL,'clientSurface','api'))$$,'22023','invalid_agent_feedback','feedback rejects Slack bot tokens');
SELECT throws_ok($$SELECT public.record_agent_feedback_v1('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','accepted','correction',NULL,'reason','AKIAIOSFODNN7EXAMPLE','outcome',NULL,'clientSurface','api'))$$,'22023','invalid_agent_feedback','feedback rejects AWS access-key identifiers');
SELECT throws_ok($$SELECT public.record_agent_feedback_v1('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','accepted','correction',NULL,'reason','AIzaSyA1234567890abcdefghijklmnop','outcome',NULL,'clientSurface','api'))$$,'22023','invalid_agent_feedback','feedback rejects Google API keys');
SELECT throws_ok($$SELECT public.record_agent_feedback_v1('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','accepted','correction',NULL,'reason','Contact person@example.test','outcome',NULL,'clientSurface','api'))$$,'22023','invalid_agent_feedback','feedback rejects email addresses');
SELECT throws_ok($$SELECT public.record_agent_feedback_v1('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','accepted','correction',NULL,'reason','Call 415-555-0123','outcome',NULL,'clientSurface','api'))$$,'22023','invalid_agent_feedback','feedback rejects phone numbers');
SELECT throws_ok($$SELECT public.record_agent_feedback_v1('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','accepted','correction',NULL,'reason','SSN 123-45-6789','outcome',NULL,'clientSurface','api'))$$,'22023','invalid_agent_feedback','feedback rejects Social Security numbers');
SELECT throws_ok($$SELECT public.record_agent_feedback_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','accepted','correction',NULL,'reason','Use ghp_abcdefghijklmnopqrstuvwxyz1234567890','outcome',NULL,'clientSurface','api')
)$$,'22023','invalid_agent_feedback','feedback free text rejects bare provider-token canaries');
SELECT set_config('test.feedback',public.record_agent_feedback_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','edited','correction','Use 12 instead','reason','Manager corrected quantity','outcome',NULL,'clientSurface','api')
)::TEXT,true);
SELECT is((SELECT outcome FROM public.agent_evaluation_outcome_labels WHERE company_id='a2000000-0000-4000-8000-000000000001' AND recommendation_run_id='a8000000-0000-4000-8000-000000000001'),'edited','feedback durably labels the exact recommendation outcome');
SELECT ok((SELECT evaluation_run_id IS NOT NULL FROM public.agent_evaluation_outcome_labels WHERE company_id='a2000000-0000-4000-8000-000000000001' AND recommendation_run_id='a8000000-0000-4000-8000-000000000001'),'outcome labels correlate to the matching durable evaluation run when available');
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT set_config('test.member_feedback',public.record_agent_feedback_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version'),'decision','accepted','correction',NULL,'reason','Contributor confirmed the outcome','outcome',NULL,'clientSurface','api')
)::TEXT,true);
SELECT ok((current_setting('test.member_feedback')::JSONB->>'id') IS NOT NULL,'company members can record bounded feedback without an admin-only mismatch');
SELECT set_config('test.member_memory',public.create_agent_memory_candidate_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','type','outcome_signal','content',jsonb_build_object('summary','Contributor-confirmed result','facts','[]'::JSONB),'applicability',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId','a6000000-0000-4000-8000-000000000001','vendorId',NULL,'productId',NULL,'userId',NULL),'provenance',jsonb_build_object('sourceFeedbackId',current_setting('test.member_feedback')::JSONB->>'id','sourceOutcomeId',NULL,'sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version')),'confidence',0.7,'expiresAt',NULL,'retentionUntil',NULL)
)::TEXT,true);
SELECT is(current_setting('test.member_memory')::JSONB->>'status','pending_review','member feedback can persist a review-only memory suggestion');
SELECT throws_ok($$SELECT public.create_agent_memory_candidate_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','type','outcome_signal','content',jsonb_build_object('summary','Use another actor feedback','facts','[]'::JSONB),'applicability',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId',NULL,'productId',NULL,'userId',NULL),'provenance',jsonb_build_object('sourceFeedbackId',current_setting('test.feedback')::JSONB->>'id','sourceOutcomeId',NULL,'sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version')),'confidence',0.7,'expiresAt',NULL,'retentionUntil',NULL)
)$$,'P0002','candidate_not_found','members cannot promote another actor feedback into a memory suggestion');
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.create_agent_memory_candidate_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','type','correction_pattern','content',jsonb_build_object('summary','Store api key from prompt','facts','[]'::JSONB),'applicability',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId',NULL,'productId',NULL,'userId',NULL),'provenance',jsonb_build_object('sourceFeedbackId',current_setting('test.feedback')::JSONB->>'id','sourceOutcomeId',NULL,'sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version')),'confidence',0.9,'expiresAt',NULL,'retentionUntil',NULL)
)$$,'22023','invalid_memory_candidate','database memory guard rejects credentials, prompts, and secret-like content');
SELECT throws_ok($$SELECT public.create_agent_memory_candidate_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','type','correction_pattern','content',jsonb_build_object('summary','Bearer abcdefghijklmnopqrstuvwxyz','facts','[]'::JSONB),'applicability',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId',NULL,'productId',NULL,'userId',NULL),'provenance',jsonb_build_object('sourceFeedbackId',current_setting('test.feedback')::JSONB->>'id','sourceOutcomeId',NULL,'sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version')),'confidence',0.9,'expiresAt',NULL,'retentionUntil',NULL)
)$$,'22023','invalid_memory_candidate','database memory guard rejects bare credential canaries even through the public RPC');
SELECT throws_ok($$SELECT public.create_agent_memory_candidate_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','type','correction_pattern','content',jsonb_build_object('summary','Contact person@example.test at 415-555-0123','facts','[]'::JSONB),'applicability',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId',NULL,'productId',NULL,'userId',NULL),'provenance',jsonb_build_object('sourceFeedbackId',current_setting('test.feedback')::JSONB->>'id','sourceOutcomeId',NULL,'sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version')),'confidence',0.9,'expiresAt',NULL,'retentionUntil',NULL)
)$$,'22023','invalid_memory_candidate','memory candidates reject common personally identifying text');
SELECT set_config('test.memory',public.create_agent_memory_candidate_v1(
  'a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
  jsonb_build_object('companyId','a2000000-0000-4000-8000-000000000001','type','correction_pattern','content',jsonb_build_object('summary','Prefer reviewed quantity','facts',jsonb_build_array(jsonb_build_object('key','quantity','value',12))),'applicability',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId','b3000000-0000-4000-8000-000000000001','productId',NULL,'userId',NULL),'provenance',jsonb_build_object('sourceFeedbackId',current_setting('test.feedback')::JSONB->>'id','sourceOutcomeId',NULL,'sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version')),'confidence',0.9,'expiresAt',NULL,'retentionUntil',NULL)
)::TEXT,true);
SELECT ok((current_setting('test.memory')::JSONB->>'id') IS NOT NULL,'feedback provenance creates a governed pending memory candidate');
SELECT is(jsonb_array_length(public.retrieve_agent_memory_v1('a2000000-0000-4000-8000-000000000001',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId','b3000000-0000-4000-8000-000000000001','productId',NULL,'userId',NULL),10,now())),0,'pending memory is never retrievable');
SELECT set_config('test.memory',public.review_agent_memory_candidate_v1('a2000000-0000-4000-8000-000000000001',(current_setting('test.memory')::JSONB->>'id')::UUID,'a1000000-0000-4000-8000-000000000001','approve','Reviewed and safe',NULL,(current_setting('test.memory')::JSONB->>'updatedAt')::TIMESTAMPTZ)::TEXT,true);
SELECT is(current_setting('test.memory')::JSONB->>'status','approved','admins explicitly approve memory candidates');
SELECT is(public.retrieve_agent_memory_v1('a2000000-0000-4000-8000-000000000001',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId','b3000000-0000-4000-8000-000000000001','productId',NULL,'userId',NULL),10,now()) #>> '{0,provenance,recommendationId}','a8000000-0000-4000-8000-000000000001','retrieval returns approved memory with provenance');
RESET ROLE;
INSERT INTO public.agent_memory_candidates(
  company_id,feedback_id,workflow_id,memory_type,content,provenance,scope,confidence,status,
  reviewer_id,reviewed_at,approved_at,review_reason,expires_at,created_at,updated_at
) VALUES (
  'a2000000-0000-4000-8000-000000000001',(current_setting('test.feedback')::JSONB->>'id')::UUID,
  'a3000000-0000-4000-8000-000000000001','preference','{"summary":"Expired preference","facts":[]}',
  jsonb_build_object('sourceFeedbackId',current_setting('test.feedback')::JSONB->>'id','sourceOutcomeId',NULL,'sourceItemId','a6000000-0000-4000-8000-000000000001','recommendationId','a8000000-0000-4000-8000-000000000001','recommendationVersion',current_setting('test.review_version')),
  jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId','b3000000-0000-4000-8000-000000000002','productId',NULL,'userId',NULL),
  0.8,'approved','a1000000-0000-4000-8000-000000000001',now()-interval '2 days',now()-interval '2 days',
  'Previously reviewed',now()-interval '1 day',now()-interval '3 days',now()-interval '2 days'
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(jsonb_array_length(public.retrieve_agent_memory_v1('a2000000-0000-4000-8000-000000000001',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId','b3000000-0000-4000-8000-000000000002','productId',NULL,'userId',NULL),10,now()-interval '4 days')),0,'backdating asOf cannot recover memory that is expired now');
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.retrieve_agent_memory_v1('a2000000-0000-4000-8000-000000000001',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId',NULL,'productId',NULL,'userId','a1000000-0000-4000-8000-000000000001'),10,now())$$,'42501','forbidden','members cannot query another user scoped memory through the public RPC');
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(public.forget_agent_memory_candidate_v1('a2000000-0000-4000-8000-000000000001',(current_setting('test.memory')::JSONB->>'id')::UUID,'a1000000-0000-4000-8000-000000000001','Delete reviewed memory',(current_setting('test.memory')::JSONB->>'updatedAt')::TIMESTAMPTZ)->>'status','forgotten','forget creates an explicit tombstone receipt');
SELECT is((SELECT jsonb_typeof(item->'content') FROM jsonb_array_elements(public.export_agent_memory_v1('a2000000-0000-4000-8000-000000000001')) item WHERE item->>'id'=current_setting('test.memory')::JSONB->>'id'),'null','memory export retains provenance but removes forgotten content');
SELECT is(jsonb_array_length(public.retrieve_agent_memory_v1('a2000000-0000-4000-8000-000000000001',jsonb_build_object('workspaceId',NULL,'agentId',NULL,'itemId',NULL,'vendorId','b3000000-0000-4000-8000-000000000001','productId',NULL,'userId',NULL),10,now())),0,'forgotten memory is no longer retrievable');

SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.retrieve_agent_memory_v1('a2000000-0000-4000-8000-000000000001','{}',10,now())$$,'42501','forbidden','cross-company memory retrieval is denied');

RESET ROLE;
INSERT INTO public.agent_evaluation_cases(id,company_id,case_key,version,fixture,input_digest,missing_data_state,created_by)
VALUES('b1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','runtime_case','1.0.0','{}',repeat('3',64),'complete','a1000000-0000-4000-8000-000000000001');
INSERT INTO public.agent_evaluation_runs(
  id,company_id,evaluation_case_id,workflow_id,manifest_digest,dataset_digest,evaluator_version,confidence_definition_version,threshold_decision
) VALUES (
  'b2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',repeat('4',64),repeat('5',64),'1.0.0','1.0.0','blocked'
);
SELECT throws_ok($$UPDATE public.agent_evaluation_cases SET fixture='{"changed":true}' WHERE id='b1000000-0000-4000-8000-000000000001'$$,'55000','agent_runtime_history_immutable','evaluation fixtures are immutable and reproducible');
INSERT INTO public.agent_promotion_checkpoints(company_id,workflow_id,workflow_version,evaluation_run_id,thresholds,decision,reason)
VALUES('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','1.0.0','b2000000-0000-4000-8000-000000000001','{"minAccuracy":0.9}','blocked','Quality threshold failed');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(public.record_agent_test_evaluation_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',7,'a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','[]','1.0.0','Refresh before promotion check')->>'lifecycleState','paused','promotion is evaluated only after current readiness succeeds');
SELECT throws_ok($$SELECT public.transition_agent_lifecycle_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','resume',8,'Resume agent')$$,'55000','promotion_checkpoint_blocked','failed evaluation checkpoints block activation and resume');
SELECT ok(NOT has_function_privilege('authenticated','workflow_private.rollback_agent_workflow_runtime_bridge(uuid,uuid,uuid,uuid,bigint,text)','EXECUTE'),'version rollback bridge is private while the checked public RPC remains callable');
SELECT throws_ok($$SELECT public.rollback_agent_workflow('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a3100000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',8,'Rollback after review')$$,'22023','rollback_target_must_differ','rollback cannot create two lifecycle sources for the same workflow version');

RESET ROLE;
-- Reuse the lifecycle fixture for a separate registered-execution scenario
-- without weakening the production immutability trigger.
ALTER TABLE public.agent_workflows DISABLE TRIGGER agent_workflows_activated_immutable;
UPDATE public.agent_workflows
SET skill_source_hash=repeat('6',64),compiler_version='1.0.0',compiled_manifest_hash=repeat('8',64),compiled_at=now(),
  spec=jsonb_build_object(
    'schemaVersion','mandala.ai/v1','compilerVersion','1.0.0',
    'capabilityBindings',jsonb_build_array(jsonb_build_object(
      'alias','purchase_order_executor','id','procurement.purchase-order.mock-execute','version','1.0.0','access','execute',
      'connectorId','c1000000-0000-4000-8000-000000000001',
      'schemaDigest',(SELECT schema_hash FROM public.capability_definition_versions WHERE id='61000000-0000-0000-0000-000000000106')
    )),
    'actions',jsonb_build_array(jsonb_build_object('id','runtime_action','mode','mock','requires_approval',true,'capability','procurement.purchase-order.mock-execute')),
    'approvals',jsonb_build_array(jsonb_build_object('action','runtime_action','human_required',true)),
    'records',jsonb_build_object('draft',jsonb_build_object('action','runtime_action'))
  )
WHERE id='a3000000-0000-4000-8000-000000000001';
ALTER TABLE public.agent_workflows ENABLE TRIGGER agent_workflows_activated_immutable;
INSERT INTO public.company_connector_installations(
  id,company_id,connector_definition_id,connector_version_id,display_name,status,installed_by
) VALUES (
  'c1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
  '60000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000101','Runtime connector','connected','a1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.company_connector_capability_grants(
  id,company_id,installation_id,capability_version_id,status,granted_by
) VALUES (
  'c2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001','61000000-0000-0000-0000-000000000106','active','a1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.company_connector_health(installation_id,company_id,status,observed_schema_hash,details)
SELECT 'c1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','healthy',schema_hash,'{}'
FROM public.connector_definition_versions WHERE id='60000000-0000-0000-0000-000000000101';
INSERT INTO public.company_capability_policies(
  company_id,capability_version_id,enabled,minimum_role,allow_model_processing,require_human_approval,max_rows,max_bytes,updated_by
) VALUES (
  'a2000000-0000-4000-8000-000000000001','61000000-0000-0000-0000-000000000106',true,'member',false,true,100,262144,'a1000000-0000-4000-8000-000000000001'
);
INSERT INTO public.workflow_binding_snapshots(id,company_id,workflow_id,manifest_hash,grant_digest,created_by)
VALUES('a3200000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',repeat('8',64),repeat('7',64),'a1000000-0000-4000-8000-000000000001');
INSERT INTO public.workflow_capability_bindings(company_id,binding_snapshot_id,requirement_key,grant_id,capability_version_id)
VALUES('a2000000-0000-4000-8000-000000000001','a3200000-0000-4000-8000-000000000001','purchase_order_executor','c2000000-0000-4000-8000-000000000001','61000000-0000-0000-0000-000000000106');
UPDATE public.workflow_runs SET workflow_binding_snapshot_id='a3200000-0000-4000-8000-000000000001'
WHERE id='a4000000-0000-4000-8000-000000000001';
UPDATE public.agent_runtime_states
SET lifecycle_state='active',readiness_status='ready',readiness_issues='[]',readiness_hash=repeat('a',64),binding_snapshot_id='a3200000-0000-4000-8000-000000000001'
WHERE company_id='a2000000-0000-4000-8000-000000000001' AND workflow_id='a3000000-0000-4000-8000-000000000001';
UPDATE public.workflow_action_drafts SET status='approved'
WHERE id='aa000000-0000-4000-8000-000000000001';
UPDATE public.workflow_items SET status='active'
WHERE id='a6000000-0000-4000-8000-000000000001';
UPDATE public.agent_action_definitions
SET capability_version_id='61000000-0000-0000-0000-000000000106',
  allowed_modes=ARRAY['fixture','mock','dry_run','shadow']
WHERE action_key='runtime_action' AND version='1.0.0';
INSERT INTO public.workflow_execution_tokens(id,company_id,action_draft_id,action_type,token_hash,payload_hash,expires_at,created_by)
VALUES
  ('ac000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','runtime_action',encode(extensions.digest(convert_to('registered-token','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to('{}'::JSONB::TEXT,'UTF8'),'sha256'),'hex'),now()+interval '1 hour','a1000000-0000-4000-8000-000000000001'),
  ('ac000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','runtime_action',repeat('3',64),encode(extensions.digest(convert_to('{}'::JSONB::TEXT,'UTF8'),'sha256'),'hex'),now()+interval '1 hour','a1000000-0000-4000-8000-000000000001'),
  ('ac000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','runtime_action',encode(extensions.digest(convert_to('reconciliation-token','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to('{}'::JSONB::TEXT,'UTF8'),'sha256'),'hex'),now()+interval '1 hour','a1000000-0000-4000-8000-000000000001'),
  ('ac000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','runtime_action',encode(extensions.digest(convert_to('policy-race-token','UTF8'),'sha256'),'hex'),encode(extensions.digest(convert_to('{}'::JSONB::TEXT,'UTF8'),'sha256'),'hex'),now()+interval '1 hour','a1000000-0000-4000-8000-000000000001');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('test.registered_context',public.get_registered_agent_execution_context_v1(
  'a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001'
)::TEXT,true);
SELECT is(current_setting('test.registered_context')::JSONB->>'kind','registered','production execution resolves a skill action through the registered runtime');
SELECT is(current_setting('test.registered_context')::JSONB->>'mode','fixture','fixture-origin mock actions resolve to the fixture adapter mode');
SELECT is(current_setting('test.registered_context')::JSONB->>'connectorId','c1000000-0000-4000-8000-000000000001','execution binds the exact installed connector from the frozen manifest');
SELECT ok((current_setting('test.registered_context')::JSONB #>> '{policy,allowed}')::BOOLEAN,'current lifecycle, approval, grant, schema, health, and binding policy permit execution');
RESET ROLE;
ALTER TABLE public.agent_workflows DISABLE TRIGGER agent_workflows_activated_immutable;
ALTER TABLE public.agent_workflows DISABLE TRIGGER agent_workflows_compiled_version_immutable;
UPDATE public.agent_workflows SET spec=jsonb_set(spec,'{actions,0,mode}','"dry_run"')
WHERE id='a3000000-0000-4000-8000-000000000001';
ALTER TABLE public.agent_workflows ENABLE TRIGGER agent_workflows_compiled_version_immutable;
ALTER TABLE public.agent_workflows ENABLE TRIGGER agent_workflows_activated_immutable;
SELECT is(public.get_registered_agent_execution_context_v1(
  'a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001'
)->>'mode','dry_run','real dry-run manifests resolve an executor whose allowed modes match');
ALTER TABLE public.agent_workflows DISABLE TRIGGER agent_workflows_activated_immutable;
ALTER TABLE public.agent_workflows DISABLE TRIGGER agent_workflows_compiled_version_immutable;
UPDATE public.agent_workflows SET spec=jsonb_set(spec,'{actions,0,mode}','"shadow"')
WHERE id='a3000000-0000-4000-8000-000000000001';
ALTER TABLE public.agent_workflows ENABLE TRIGGER agent_workflows_compiled_version_immutable;
ALTER TABLE public.agent_workflows ENABLE TRIGGER agent_workflows_activated_immutable;
SELECT is(public.get_registered_agent_execution_context_v1(
  'a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001'
)->>'mode','shadow','real shadow manifests resolve an executor whose allowed modes match');
ALTER TABLE public.agent_workflows DISABLE TRIGGER agent_workflows_activated_immutable;
ALTER TABLE public.agent_workflows DISABLE TRIGGER agent_workflows_compiled_version_immutable;
UPDATE public.agent_workflows SET spec=jsonb_set(spec,'{actions,0,mode}','"mock"')
WHERE id='a3000000-0000-4000-8000-000000000001';
ALTER TABLE public.agent_workflows ENABLE TRIGGER agent_workflows_compiled_version_immutable;
ALTER TABLE public.agent_workflows ENABLE TRIGGER agent_workflows_activated_immutable;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('test.registered_begin',public.begin_registered_agent_execution_v1(
  'a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',
  'registered-token','web:11111111-1111-4111-8111-111111111111',repeat('4',64),'fixture'
)::TEXT,true);
SELECT is(current_setting('test.registered_begin')::JSONB->>'kind','started','registered execution atomically consumes the approval token and starts a durable attempt');
SELECT ok(NOT has_function_privilege(
  'authenticated','public.complete_registered_agent_execution_v1(uuid,uuid,text,text,jsonb)','EXECUTE'
),'authenticated approvers cannot forge a successful completion or receipt');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(public.complete_registered_agent_execution_v1(
  'a2000000-0000-4000-8000-000000000001',(current_setting('test.registered_begin')::JSONB->>'executionId')::UUID,
  'web:11111111-1111-4111-8111-111111111111',repeat('4',64),
  jsonb_build_object('status','succeeded','executionId',current_setting('test.registered_begin')::JSONB->>'executionId')
) #>> '{attempt,status}','succeeded','registered completion rechecks policy and durably closes the attempt');
RESET ROLE;
SELECT is((SELECT count(*)::INTEGER FROM public.agent_execution_receipts receipt
  WHERE receipt.action_attempt_id=(current_setting('test.registered_begin')::JSONB->>'executionId')::UUID),2,
  'registered execution records immutable start and completion receipts');
SELECT ok((SELECT bool_and(
    (receipt_sequence=1 AND status='processing' AND effect_state='none')
    OR (receipt_sequence=2 AND status='succeeded' AND effect_state='simulated')
  ) FROM public.agent_execution_receipts receipt
  WHERE receipt.action_attempt_id=(current_setting('test.registered_begin')::JSONB->>'executionId')::UUID),
  'receipt history distinguishes the guarded start from the simulated outcome');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(public.begin_registered_agent_execution_v1(
  'a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',
  'registered-token','web:11111111-1111-4111-8111-111111111111',repeat('4',64),'fixture'
)->>'kind','replay','a repeated registered request replays the durable receipt without another provider attempt');
RESET ROLE;
UPDATE public.workflow_action_drafts SET status='approved'
WHERE id='aa000000-0000-4000-8000-000000000001';
UPDATE public.workflow_items SET status='active'
WHERE id='a6000000-0000-4000-8000-000000000001';
UPDATE public.workflow_runs SET status='waiting_for_approval',completed_at=NULL
WHERE id='a4000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('test.reconciliation_begin',public.begin_registered_agent_execution_v1(
  'a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',
  'reconciliation-token','web:22222222-2222-4222-8222-222222222222',repeat('5',64),'fixture'
)::TEXT,true);
SELECT is(current_setting('test.reconciliation_begin')::JSONB->>'kind','started','a second registered execution starts with a distinct guarded token');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('test.reconciliation_result',public.complete_registered_agent_execution_v1(
  'a2000000-0000-4000-8000-000000000001',(current_setting('test.reconciliation_begin')::JSONB->>'executionId')::UUID,
  'web:22222222-2222-4222-8222-222222222222',repeat('5',64),
  jsonb_build_object('status','reconciliation_required','retryClass','unknown','code','executor_timeout_outcome_unknown')
)::TEXT,true);
SELECT is(current_setting('test.reconciliation_result')::JSONB #>> '{attempt,status}','reconciliation_required','timeout-after-dispatch durably finalizes as reconciliation required');
RESET ROLE;
SELECT ok((SELECT reconciliation_required AND completed_at IS NOT NULL AND effect_state='unknown'
  FROM public.workflow_action_attempts
  WHERE id=(current_setting('test.reconciliation_begin')::JSONB->>'executionId')::UUID),
  'reconciliation completion never leaves the attempt processing or its outcome ambiguous');
SELECT ok((SELECT status='reconciliation_required' AND failure_class='reconciliation_required' AND effect_state='unknown'
  FROM public.agent_execution_receipts
  WHERE action_attempt_id=(current_setting('test.reconciliation_begin')::JSONB->>'executionId')::UUID AND receipt_sequence=2),
  'reconciliation completion writes an explicit durable terminal receipt');
INSERT INTO public.workflow_action_attempts(
  id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,idempotency_key,action_type,mode,status,request_payload,result_payload
) VALUES (
  'ad000000-0000-4000-8000-000000000030','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000003','current-binding','runtime_action','mock','succeeded','{}','{}'
);
SELECT ok((SELECT action_definition_id IS NOT NULL FROM public.workflow_action_attempts WHERE id='ad000000-0000-4000-8000-000000000030'),'execution succeeds only while its exact capability binding remains current');

RESET ROLE;
UPDATE public.company_connector_capability_grants SET status='revoked',revoked_by='a1000000-0000-4000-8000-000000000001',revoked_at=now() WHERE id='c2000000-0000-4000-8000-000000000001';
SELECT throws_ok($$INSERT INTO public.workflow_action_attempts(id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,idempotency_key,action_type,mode,status,request_payload,result_payload) VALUES('ad000000-0000-4000-8000-000000000031','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000003','revoked-grant','runtime_action','mock','succeeded','{}','{}')$$,'55000','execution_context_stale','execution rechecks the current active grant');
RESET ROLE;
UPDATE public.company_connector_capability_grants SET status='active',revoked_by=NULL,revoked_at=NULL WHERE id='c2000000-0000-4000-8000-000000000001';
UPDATE public.company_connector_installations SET status='disabled' WHERE id='c1000000-0000-4000-8000-000000000001';
SELECT throws_ok($$INSERT INTO public.workflow_action_attempts(id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,idempotency_key,action_type,mode,status,request_payload,result_payload) VALUES('ad000000-0000-4000-8000-000000000032','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000003','disabled-installation','runtime_action','mock','succeeded','{}','{}')$$,'55000','execution_context_stale','execution rechecks the current connector installation');
RESET ROLE;
UPDATE public.company_connector_installations SET status='connected' WHERE id='c1000000-0000-4000-8000-000000000001';
UPDATE public.company_connector_health SET status='degraded' WHERE installation_id='c1000000-0000-4000-8000-000000000001';
SELECT throws_ok($$INSERT INTO public.workflow_action_attempts(id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,idempotency_key,action_type,mode,status,request_payload,result_payload) VALUES('ad000000-0000-4000-8000-000000000033','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000003','unhealthy-connector','runtime_action','mock','succeeded','{}','{}')$$,'55000','execution_context_stale','execution rechecks current connector health');
RESET ROLE;
UPDATE public.company_connector_health SET status='healthy',observed_schema_hash=repeat('0',64) WHERE installation_id='c1000000-0000-4000-8000-000000000001';
SELECT throws_ok($$INSERT INTO public.workflow_action_attempts(id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,idempotency_key,action_type,mode,status,request_payload,result_payload) VALUES('ad000000-0000-4000-8000-000000000034','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000003','schema-drift','runtime_action','mock','succeeded','{}','{}')$$,'55000','execution_context_stale','execution rechecks the connector schema digest');
RESET ROLE;
UPDATE public.company_connector_health health SET observed_schema_hash=version.schema_hash FROM public.connector_definition_versions version WHERE health.installation_id='c1000000-0000-4000-8000-000000000001' AND version.id='60000000-0000-0000-0000-000000000101';
UPDATE public.company_capability_policies SET enabled=false WHERE company_id='a2000000-0000-4000-8000-000000000001' AND capability_version_id='61000000-0000-0000-0000-000000000106';
SELECT throws_ok($$INSERT INTO public.workflow_action_attempts(id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,idempotency_key,action_type,mode,status,request_payload,result_payload) VALUES('ad000000-0000-4000-8000-000000000035','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000003','disabled-policy','runtime_action','mock','succeeded','{}','{}')$$,'55000','execution_context_stale','execution rechecks the current company capability policy');
RESET ROLE;
UPDATE public.company_capability_policies SET enabled=true WHERE company_id='a2000000-0000-4000-8000-000000000001' AND capability_version_id='61000000-0000-0000-0000-000000000106';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('test.policy_race_begin',public.begin_registered_agent_execution_v1(
  'a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',
  'policy-race-token','web:33333333-3333-4333-8333-333333333333',repeat('6',64),'fixture'
)::TEXT,true);
SELECT is(current_setting('test.policy_race_begin')::JSONB->>'kind','started','registered execution can begin while its frozen policy snapshot is current');
SELECT lives_ok($$SELECT public.set_company_capability_policy(
  'a2000000-0000-4000-8000-000000000001','61000000-0000-0000-0000-000000000106',
  true,'member',false,true,101,262144
)$$,'an authorized policy change is recorded after the execution begins');
SELECT is(public.get_registered_agent_execution_context_v1(
  'a2000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001'
) #>> '{policy,reason}','execution_context_stale','a company policy change invalidates the frozen execution context before adapter dispatch');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT throws_ok($$SELECT public.complete_registered_agent_execution_v1(
  'a2000000-0000-4000-8000-000000000001',(current_setting('test.policy_race_begin')::JSONB->>'executionId')::UUID,
  'web:33333333-3333-4333-8333-333333333333',repeat('6',64),
  jsonb_build_object('status','succeeded','executionId',current_setting('test.policy_race_begin')::JSONB->>'executionId')
)$$,'55000','execution_context_stale','a policy change after begin blocks service-role completion');
RESET ROLE;
SELECT is((SELECT status FROM public.workflow_action_attempts
  WHERE id=(current_setting('test.policy_race_begin')::JSONB->>'executionId')::UUID),'processing',
  'the blocked completion cannot falsely finalize the attempt as succeeded');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_execution_receipts
  WHERE action_attempt_id=(current_setting('test.policy_race_begin')::JSONB->>'executionId')::UUID),1,
  'the blocked completion leaves only the immutable start receipt');
SELECT is((SELECT count(*)::INTEGER FROM public.agent_execution_receipts
  WHERE action_attempt_id=(current_setting('test.policy_race_begin')::JSONB->>'executionId')::UUID AND status='succeeded'),0,
  'no success receipt is written after the company policy changes');
SELECT throws_ok($$INSERT INTO public.workflow_action_attempts(id,company_id,workflow_run_id,workflow_item_id,action_draft_id,decision_id,execution_token_id,idempotency_key,action_type,mode,status,request_payload,result_payload) VALUES('ad000000-0000-4000-8000-000000000036','a2000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001','ac000000-0000-4000-8000-000000000003','invalidated-snapshot','runtime_action','mock','succeeded','{}','{}')$$,'55000','execution_context_stale','execution rejects an invalidated binding snapshot');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT is((SELECT count(*)::INTEGER FROM public.agent_runtime_states),0,'RLS hides another company lifecycle state');
SELECT throws_ok($$SELECT public.transition_agent_lifecycle_v1('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','disable',8,'Cross tenant')$$,'42501','forbidden','lifecycle functions enforce company membership internally');

SELECT * FROM finish();
ROLLBACK;
