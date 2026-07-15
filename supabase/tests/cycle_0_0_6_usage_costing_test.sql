BEGIN;
SELECT plan(44);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('81000000-0000-4000-8000-000000000001','authenticated','authenticated','usage-owner-a@example.test','',now(),'{}','{}',now(),now()),
  ('81000000-0000-4000-8000-000000000002','authenticated','authenticated','usage-owner-b@example.test','',now(),'{}','{}',now(),now()),
  ('81000000-0000-4000-8000-000000000003','authenticated','authenticated','usage-owner-c@example.test','',now(),'{}','{}',now(),now());

INSERT INTO public.companies (id, name, created_by) VALUES
  ('82000000-0000-4000-8000-000000000001','Usage Company A','81000000-0000-4000-8000-000000000001'),
  ('82000000-0000-4000-8000-000000000002','Usage Company B','81000000-0000-4000-8000-000000000002'),
  ('82000000-0000-4000-8000-000000000003','Usage Company C','81000000-0000-4000-8000-000000000003');
INSERT INTO public.company_memberships (company_id, user_id, role, status) VALUES
  ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','owner','active'),
  ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','owner','active'),
  ('82000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003','owner','active');

SELECT has_table('public','provider_usage_events','immutable provider usage table exists');
SELECT has_table('public','provider_model_rates','versioned provider rate table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.provider_usage_events'::regclass),'usage events enable RLS');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.provider_model_rates'::regclass),'provider rates enable RLS');
SELECT ok(NOT has_table_privilege('authenticated','public.provider_usage_events','INSERT'),'authenticated callers cannot forge raw usage rows');
SELECT ok(NOT has_table_privilege('authenticated','public.provider_usage_events','SELECT'),'authenticated callers cannot bypass the checked summary projection');
SELECT ok(NOT has_function_privilege('authenticated','public.record_provider_usage_v1(uuid,uuid,text,text,text,timestamp with time zone,text,jsonb,text,uuid,text,text)','EXECUTE'),'browser and CLI clients cannot forge provider usage through the RPC');
SELECT ok(has_function_privilege('service_role','public.record_provider_usage_v1(uuid,uuid,text,text,text,timestamp with time zone,text,jsonb,text,uuid,text,text)','EXECUTE'),'the server-only service role can write through the bounded usage RPC');
SELECT ok(has_function_privilege('authenticated','public.get_company_usage_summary_v1(uuid,timestamp with time zone,timestamp with time zone)','EXECUTE'),'authenticated members can request a checked company summary');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid='public.record_provider_usage_v1(uuid,uuid,text,text,text,timestamp with time zone,text,jsonb,text,uuid,text,text)'::regprocedure),true,'usage recording is a security-definer boundary');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.record_provider_usage_v1(uuid,uuid,text,text,text,timestamp with time zone,text,jsonb,text,uuid,text,text)'::regprocedure),'usage recording fixes an empty search path');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid='public.get_company_usage_summary_v1(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure),true,'usage summaries are a security-definer boundary');
SELECT ok((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid='public.get_company_usage_summary_v1(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure),'usage summaries fix an empty search path');
SELECT is((SELECT count(*)::INTEGER FROM information_schema.columns WHERE table_schema='public' AND table_name='provider_usage_events' AND column_name IN ('prompt','input','output','response','payload','api_key','email')),0,'the ledger has no prompt, output, payload, secret, or email columns');

SELECT lives_ok($$INSERT INTO public.provider_model_rates(id,provider,model,metric_name,rate_version,currency,quantity_per_unit,price_per_unit,effective_from,effective_to,source_reference) VALUES('83000000-0000-4000-8000-000000000001','openai','gpt-5.4-mini','input_tokens','input-old','USD',1000000,2,now()-interval '10 days',now()-interval '2 days','provider-price-fixture')$$,'an older bounded input-token rate can be registered');
SELECT lives_ok($$INSERT INTO public.provider_model_rates(id,provider,model,metric_name,rate_version,currency,quantity_per_unit,price_per_unit,effective_from,source_reference) VALUES('83000000-0000-4000-8000-000000000002','openai','gpt-5.4-mini','input_tokens','input-current','USD',1000000,4,now()-interval '2 days','provider-price-fixture')$$,'a non-overlapping current input-token rate can be registered');
SELECT lives_ok($$INSERT INTO public.provider_model_rates(id,provider,model,metric_name,rate_version,currency,quantity_per_unit,price_per_unit,effective_from,source_reference) VALUES('83000000-0000-4000-8000-000000000003','openai','gpt-5.4-mini','output_tokens','output-current','USD',1000000,8,now()-interval '10 days','provider-price-fixture')$$,'an output-token rate can be registered');
SELECT lives_ok($$INSERT INTO public.provider_model_rates(id,provider,model,metric_name,rate_version,currency,quantity_per_unit,price_per_unit,effective_from,source_reference) VALUES('83000000-0000-4000-8000-000000000004','openai','gpt-5.4-mini','requests','request-current','USD',1,0.001,now()-interval '10 days','provider-price-fixture')$$,'a request rate can be registered');
SELECT throws_ok($$INSERT INTO public.provider_model_rates(provider,model,metric_name,rate_version,currency,quantity_per_unit,price_per_unit,effective_from,source_reference) VALUES('openai','gpt-5.4-mini','input_tokens','overlap','USD',1000000,99,now()-interval '1 day','bad-overlap')$$,'23P01','provider_rate_window_overlap','overlapping rate windows fail closed');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT lives_ok($$SELECT public.record_provider_usage_v1('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','mandala.work_item.question','openai','gpt-5.4-mini',now()-interval '3 days','complete','{"input_tokens":1000,"output_tokens":500,"total_tokens":1500,"requests":1}','usage-old-event',NULL,'trace-old','run-old')$$,'the server records complete provider usage for an active company member');
SELECT is((SELECT count(*)::INTEGER FROM public.provider_usage_events WHERE company_id='82000000-0000-4000-8000-000000000001'),1,'one logical invocation creates one event');
SELECT ok((SELECT payload_digest ~ '^[0-9a-f]{64}$' FROM public.provider_usage_events WHERE idempotency_key='usage-old-event'),'the database binds every event to its canonical payload digest');
SELECT is((public.record_provider_usage_v1('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','mandala.work_item.question','openai','gpt-5.4-mini',(SELECT measured_at FROM public.provider_usage_events WHERE idempotency_key='usage-old-event'),'complete','{"requests":1,"total_tokens":1500,"output_tokens":500,"input_tokens":1000}','usage-old-event',NULL,'trace-old','run-old')->>'duplicate')::BOOLEAN,true,'an exact replay is a no-op even when metric key order changes');
SELECT is((SELECT count(*)::INTEGER FROM public.provider_usage_events WHERE company_id='82000000-0000-4000-8000-000000000001'),1,'an exact replay cannot double count');
SELECT throws_ok($$SELECT public.record_provider_usage_v1('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','mandala.work_item.question','openai','gpt-5.4-mini',(SELECT measured_at FROM public.provider_usage_events WHERE idempotency_key='usage-old-event'),'complete','{"input_tokens":1001,"output_tokens":500,"total_tokens":1501,"requests":1}','usage-old-event',NULL,'trace-old','run-old')$$,'23505','usage_idempotency_conflict','the same idempotency key with changed usage fails closed');
SELECT throws_ok($$SELECT public.record_provider_usage_v1('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','mandala.work_item.question','openai','gpt-5.4-mini',now(),'partial','{"input_tokens":1,"prompt":"forbidden"}','usage-unknown-metric',NULL,NULL,NULL)$$,'22023','invalid_usage_metrics','unknown metric keys cannot smuggle prompt or provider payload data');
SELECT throws_ok($$SELECT public.record_provider_usage_v1('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000001','mandala.work_item.question','openai','gpt-5.4-mini',now(),'complete','{"input_tokens":1,"output_tokens":1,"total_tokens":2}','usage-wrong-company',NULL,NULL,NULL)$$,'42501','forbidden','the service cannot attribute usage to an actor outside that company');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(public.get_company_usage_summary_v1('82000000-0000-4000-8000-000000000001',now()-interval '4 days',now())->>'completeness','current','fully measured and priced usage is current');
SELECT is((public.get_company_usage_summary_v1('82000000-0000-4000-8000-000000000001',now()-interval '4 days',now()) #>> '{costs,0,amount}')::NUMERIC,0.007::NUMERIC,'historical cost uses the older input rate effective at event time');
SELECT throws_ok($$SELECT public.get_company_usage_summary_v1('82000000-0000-4000-8000-000000000002',now()-interval '4 days',now())$$,'42501','forbidden','summary reads cannot cross companies');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT lives_ok($$SELECT public.record_provider_usage_v1('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','mandala.control.intent.parse','openai','gpt-5.4-mini',now()-interval '1 day','complete','{"input_tokens":1000,"output_tokens":500,"total_tokens":1500,"requests":1}','usage-current-event',NULL,'trace-current','run-current')$$,'a later event records against the current rate window');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is((public.get_company_usage_summary_v1('82000000-0000-4000-8000-000000000001',now()-interval '4 days',now()) #>> '{costs,0,amount}')::NUMERIC,0.016::NUMERIC,'later pricing does not rewrite the older event and the new event uses the current rate');
SELECT is(jsonb_array_length(public.get_company_usage_summary_v1('82000000-0000-4000-8000-000000000001',now()-interval '4 days',now()) #> '{costs,0,rateVersionIds}'),4,'cost evidence lists every distinct event-time rate version used');
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT lives_ok(
  $$SELECT public.publish_provider_model_rate_v1(
    'openai','gpt-5.4-mini','input_tokens','input-next','USD',
    1000000,5,now()+interval '1 hour','provider-price-fixture',NULL
  )$$,
  'a new rate version atomically closes the current open-ended window'
);
SELECT is(
  (SELECT effective_to FROM public.provider_model_rates WHERE id='83000000-0000-4000-8000-000000000002'),
  (SELECT effective_from FROM public.provider_model_rates WHERE rate_version='input-next'),
  'publishing a new version leaves contiguous immutable rate history'
);
SELECT lives_ok($$SELECT public.record_provider_usage_v1('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','mandala.control.chat.command','openai','gpt-5.4-mini',now(),'partial','{"input_tokens":10,"requests":1}','usage-partial-event',NULL,'trace-partial','run-partial')$$,'partial provider metadata is recorded explicitly');
SELECT throws_ok($$SELECT public.record_provider_usage_v1('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','mandala.control.chat.command','openai','gpt-5.4-mini',now(),'unavailable','{"input_tokens":10,"requests":1}','usage-invalid-unavailable',NULL,NULL,NULL)$$,'23514',NULL,'unavailable events cannot invent nonzero token usage');
SELECT lives_ok($$SELECT public.record_provider_usage_v1('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000002','mandala.control.chat.command','openai','gpt-5.4-mini',now(),'unavailable','{"requests":1}','usage-unavailable',NULL,NULL,NULL)$$,'missing provider usage is persisted as unavailable instead of zero-token completeness');
SELECT lives_ok($$SELECT public.record_provider_usage_v1('82000000-0000-4000-8000-000000000003','81000000-0000-4000-8000-000000000003','mandala.agent.synthetic_test','anthropic','claude-sonnet-4.5',now(),'complete','{"input_tokens":100,"output_tokens":50,"total_tokens":150,"requests":1}','usage-unpriced',NULL,NULL,NULL)$$,'complete usage can arrive before its provider rate is published');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT is(public.get_company_usage_summary_v1('82000000-0000-4000-8000-000000000001',now()-interval '4 days',now()+interval '1 minute')->>'completeness','partial','a period containing incomplete provider metadata is explicitly partial');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SELECT is(public.get_company_usage_summary_v1('82000000-0000-4000-8000-000000000002',now()-interval '1 day',now()+interval '1 minute')->>'completeness','unavailable','a period containing only unavailable provider data remains unavailable');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT is(public.get_company_usage_summary_v1('82000000-0000-4000-8000-000000000003',now()-interval '1 day',now()+interval '1 minute')->>'completeness','delayed','complete usage without event-time rates is delayed rather than zero-cost current');
RESET ROLE;

SELECT throws_ok($$UPDATE public.provider_usage_events SET input_tokens=999 WHERE idempotency_key='usage-old-event'$$,'55000','provider_usage_immutable','raw usage history cannot be rewritten');
SELECT throws_ok($$UPDATE public.provider_model_rates SET price_per_unit=999 WHERE id='83000000-0000-4000-8000-000000000001'$$,'55000','provider_rate_immutable','published rate history cannot be rewritten');

SELECT * FROM finish();
ROLLBACK;
