BEGIN;
SELECT plan(42);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('b1000000-0000-4000-8000-000000000001','authenticated','authenticated','invite-owner@example.test','',now(),'{}','{}',now(),now()),
  ('b1000000-0000-4000-8000-000000000002','authenticated','authenticated','invitee@example.test','',now(),'{}','{}',now(),now()),
  ('b1000000-0000-4000-8000-000000000003','authenticated','authenticated','second@example.test','',now(),'{}','{}',now(),now()),
  ('b1000000-0000-4000-8000-000000000004','authenticated','authenticated','viewer@example.test','',now(),'{}','{}',now(),now());

UPDATE public.profiles SET display_name = CASE user_id
  WHEN 'b1000000-0000-4000-8000-000000000001' THEN 'Invite Owner'
  WHEN 'b1000000-0000-4000-8000-000000000002' THEN 'Invited Person'
  WHEN 'b1000000-0000-4000-8000-000000000003' THEN 'Second Person'
  WHEN 'b1000000-0000-4000-8000-000000000004' THEN 'Workspace Viewer'
END
WHERE user_id IN (
  'b1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000004'
);

INSERT INTO public.companies(id, name, created_by) VALUES
  ('b2000000-0000-4000-8000-000000000001','Invitation Workspace','b1000000-0000-4000-8000-000000000001');
INSERT INTO public.company_memberships(company_id,user_id,role,status) VALUES
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','owner','active'),
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000004','viewer','active');

SELECT has_table('public','company_invitations','invitation table exists');
SELECT has_table('public','company_invitation_tokens','digest-only token table exists');
SELECT has_table('public','company_invitation_events','immutable invitation event table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.company_invitations'::regclass),'invitation RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='public.company_invitation_tokens'::regclass),'token RLS enabled');
SELECT ok(NOT has_table_privilege('authenticated','public.company_invitation_tokens','SELECT'),'clients cannot read token digests');
SELECT ok(has_function_privilege('authenticated','public.issue_company_invitation(uuid,uuid,text,text,timestamptz)','EXECUTE'),'authenticated clients can call checked issue RPC');
SELECT ok(has_function_privilege('anon','public.inspect_company_invitation(text)','EXECUTE'),'anonymous invite inspection uses a safe RPC');
SELECT ok(NOT has_function_privilege('anon','public.accept_company_invitation(text)','EXECUTE'),'anonymous clients cannot accept invitations');
SELECT ok(NOT has_table_privilege('service_role','public.company_invitation_events','INSERT'),'service clients cannot forge invitation audit history');

SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($$SELECT public.issue_company_invitation(
  'b3000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001',
  'Invitee@Example.Test', repeat('a',64), now()+interval '72 hours'
)$$,'an Owner can issue a 72-hour invitation');
RESET ROLE;
SELECT is((SELECT recipient_email FROM public.company_invitations WHERE id='b3000000-0000-4000-8000-000000000001'),'invitee@example.test','recipient email is normalized');
SELECT is((SELECT count(*)::int FROM public.company_invitation_tokens WHERE invitation_id='b3000000-0000-4000-8000-000000000001'),1,'only a digest token is persisted');
SELECT is((SELECT count(*)::int FROM public.email_deliveries WHERE payload_reference='company_invitation:b3000000-0000-4000-8000-000000000001:1'),1,'issue enqueues an opaque email payload reference');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.issue_company_invitation(
  'b3000000-0000-4000-8000-000000000099',
  'b2000000-0000-4000-8000-000000000001',
  'invitee@example.test', repeat('9',64), now()+interval '72 hours'
)$$,'23505',NULL,'an active duplicate invitation is rejected');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT is((public.inspect_company_invitation(repeat('a',64))->>'state'),'valid','a valid token has a safe public classification');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_company_invitation(repeat('a',64))$$,'42501',NULL,'a different active session cannot consume the invitation');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.accept_company_invitation(repeat('a',64))$$,'the intended email accepts atomically');
SELECT throws_ok($$SELECT public.accept_company_invitation(repeat('a',64))$$,'55000',NULL,'accepted token replay is rejected');
RESET ROLE;
SELECT is((SELECT state FROM public.company_invitations WHERE id='b3000000-0000-4000-8000-000000000001'),'accepted','invitation becomes accepted');
SELECT is((SELECT state FROM public.company_invitation_tokens WHERE invitation_id='b3000000-0000-4000-8000-000000000001'),'used','accepted token is one-time');
SELECT is((SELECT role FROM public.company_memberships WHERE company_id='b2000000-0000-4000-8000-000000000001' AND user_id='b1000000-0000-4000-8000-000000000002'),'owner','accepted member becomes an Owner');
SELECT is((SELECT status FROM public.company_memberships WHERE company_id='b2000000-0000-4000-8000-000000000001' AND user_id='b1000000-0000-4000-8000-000000000002'),'active','accepted membership is active');
SELECT is((SELECT count(*)::int FROM public.email_deliveries WHERE payload_reference='company_invitation_accepted:b3000000-0000-4000-8000-000000000001'),1,'acceptance confirmation is queued for the inviter');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.issue_company_invitation(
  'b3000000-0000-4000-8000-000000000002',
  'b2000000-0000-4000-8000-000000000001',
  'second@example.test', repeat('b',64), now()+interval '72 hours'
)$$,'a second invitation can be issued');
SELECT lives_ok($$SELECT public.resend_company_invitation(
  'b3000000-0000-4000-8000-000000000002', repeat('c',64), now()+interval '72 hours', 2
)$$,'resend rotates the token and extends 72 hours');
SELECT throws_ok($$SELECT public.resend_company_invitation(
  'b3000000-0000-4000-8000-000000000002', repeat('d',64), now()+interval '72 hours', 2
)$$,'40001','invitation_version_conflict','a stale concurrent resend cannot bind the wrong token version');
RESET ROLE;
SELECT is((SELECT state FROM public.company_invitation_tokens WHERE token_digest=repeat('b',64)),'superseded','resend supersedes the old token');
SELECT is((SELECT version FROM public.company_invitations WHERE id='b3000000-0000-4000-8000-000000000002'),2,'resend increments invitation version');
SET LOCAL ROLE authenticated;
SELECT is((public.inspect_company_invitation(repeat('b',64))->>'state'),'superseded','superseded tokens classify safely');
SELECT lives_ok($$SELECT public.revoke_company_invitation('b3000000-0000-4000-8000-000000000002')$$,'an Owner can revoke a pending invitation');
SELECT is((public.inspect_company_invitation(repeat('c',64))->>'state'),'revoked','revoked tokens classify safely');
SELECT is(jsonb_array_length(public.list_company_directory('b2000000-0000-4000-8000-000000000001')->'members'),3,'directory includes active and inactive human records');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"b1000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.issue_company_invitation(
  'b3000000-0000-4000-8000-000000000003',
  'b2000000-0000-4000-8000-000000000001',
  'nobody@example.test', repeat('d',64), now()+interval '72 hours'
)$$,'42501',NULL,'non-Owners cannot issue invitations');

RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='purge-company-invitation-pii'),'invitation PII purge is scheduled and observable');
SELECT ok(EXISTS(SELECT 1 FROM cron.job WHERE jobname='purge-terminal-email-delivery-pii'),'email delivery PII purge is scheduled and observable');
SELECT is((SELECT count(*)::int FROM public.company_invitation_events WHERE company_id='b2000000-0000-4000-8000-000000000001'),5,'issue resend revoke and accept events are immutable history');
SELECT throws_ok(
  $$UPDATE public.company_invitation_events SET event_type='expired' WHERE company_id='b2000000-0000-4000-8000-000000000001'$$,
  '55000','company_invitation_event_immutable','invitation events cannot be rewritten'
);
SELECT throws_ok(
  $$DELETE FROM public.company_invitation_events WHERE company_id='b2000000-0000-4000-8000-000000000001'$$,
  '55000','company_invitation_event_immutable','invitation events cannot be deleted'
);

INSERT INTO public.company_invitations(
  id,company_id,recipient_email,recipient_hash,inviter_user_id,state,version,issued_at,expires_at,created_at,updated_at
) VALUES (
  'b3000000-0000-4000-8000-000000000099','b2000000-0000-4000-8000-000000000001',
  'expired-pii@example.test',repeat('e',64),'b1000000-0000-4000-8000-000000000001',
  'pending',1,now()-interval '101 days',now()-interval '100 days',now()-interval '101 days',now()-interval '100 days'
);
INSERT INTO public.company_invitation_tokens(company_id,invitation_id,version,token_digest,state,issued_at,expires_at)
VALUES ('b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000099',1,repeat('e',64),'active',now()-interval '101 days',now()-interval '100 days');
SELECT lives_ok(
  $$SELECT public.purge_company_invitation_pii(now()-interval '90 days')$$,
  'retention cleanup terminally expires old pending invitations before purging PII'
);
SELECT is((SELECT state FROM public.company_invitations WHERE id='b3000000-0000-4000-8000-000000000099'),'expired','retention cleanup expires the invitation');
SELECT ok((SELECT recipient_email LIKE 'purged-%@invalid.test' FROM public.company_invitations WHERE id='b3000000-0000-4000-8000-000000000099'),'retention cleanup purges expired recipient PII');

SELECT * FROM finish();
ROLLBACK;
