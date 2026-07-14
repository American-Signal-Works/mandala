BEGIN;
SELECT plan(59);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('71000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'delivery-owner-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'delivery-viewer-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'delivery-owner-b@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by)
VALUES
  ('72000000-0000-0000-0000-000000000001', 'Delivery Company A', '71000000-0000-0000-0000-000000000001'),
  ('72000000-0000-0000-0000-000000000002', 'Delivery Company B', '71000000-0000-0000-0000-000000000003');

INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'owner'),
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'viewer'),
  ('72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000003', 'owner');

SELECT has_table('public', 'email_deliveries', 'logical delivery table exists');
SELECT has_table('public', 'email_delivery_attempts', 'attempt table exists');
SELECT has_table('public', 'email_delivery_events', 'provider event table exists');
SELECT has_table('public', 'email_suppressions', 'suppression table exists');
SELECT has_view('public', 'email_delivery_owner_status', 'safe Owner status view exists');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_deliveries'::regclass),
  'logical deliveries have RLS enabled'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.enqueue_email_delivery(uuid,text,text,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients cannot call the service enqueue RPC'
);

SELECT lives_ok($$SELECT public.enqueue_email_delivery(
  '72000000-0000-0000-0000-000000000001',
  'fixture-retry-001',
  'workspace_invite',
  '1',
  'fixture:invite:one',
  'Recipient@Example.Test',
  '2000-01-01 00:00:00+00'
)$$, 'a service process can enqueue a logical delivery');
SELECT lives_ok($$SELECT public.enqueue_email_delivery(
  '72000000-0000-0000-0000-000000000001',
  'fixture-retry-001',
  'different_template',
  '9',
  'fixture:must-not-replace',
  'other@example.test',
  '2000-01-01 00:00:00+00'
)$$, 'replaying the same application request succeeds safely');

SELECT is(
  (SELECT count(*)::int FROM public.email_deliveries WHERE idempotency_key = 'fixture-retry-001'),
  1,
  'the application idempotency key creates one logical delivery'
);
SELECT is(
  (SELECT template_key FROM public.email_deliveries WHERE idempotency_key = 'fixture-retry-001'),
  'workspace_invite',
  'a duplicate request cannot replace the original delivery contract'
);
SELECT is(
  (SELECT recipient_email FROM public.email_deliveries WHERE idempotency_key = 'fixture-retry-001'),
  'recipient@example.test',
  'recipient email is normalized and a duplicate cannot replace it'
);

CREATE TEMP TABLE first_claim AS
SELECT * FROM public.claim_due_email_deliveries(10, 120);
SELECT is((SELECT count(*)::int FROM first_claim), 1, 'one due delivery is claimed');
SELECT is(
  (SELECT state FROM public.email_deliveries WHERE id = (SELECT delivery_id FROM first_claim)),
  'sending',
  'claim moves the logical delivery to sending'
);
SELECT is(
  (SELECT count(*)::int FROM public.email_delivery_attempts WHERE delivery_id = (SELECT delivery_id FROM first_claim)),
  1,
  'claim atomically creates the first attempt'
);

SELECT lives_ok($$SELECT public.record_email_delivery_result(
  (SELECT delivery_id FROM first_claim),
  (SELECT claim_token FROM first_claim),
  'transient_failure', NULL, 'provider_unavailable',
  '2000-01-01 00:00:00+00'
)$$, 'the first transient result is recorded');
SELECT is(
  (SELECT next_attempt_at FROM public.email_deliveries WHERE id = (SELECT delivery_id FROM first_claim)),
  '2000-01-01 00:01:00+00'::timestamptz,
  'first transient failure retries after one minute'
);
SELECT is(
  (SELECT state FROM public.email_deliveries WHERE id = (SELECT delivery_id FROM first_claim)),
  'queued',
  'transient failure returns the message to the queue'
);

CREATE TEMP TABLE second_claim AS
SELECT * FROM public.claim_due_email_deliveries(10, 120);
SELECT is((SELECT attempt_number FROM second_claim), 2, 'the retry is attempt two');
SELECT lives_ok($$SELECT public.record_email_delivery_result(
  (SELECT delivery_id FROM second_claim), (SELECT claim_token FROM second_claim),
  'transient_failure', NULL, 'provider_unavailable', '2000-01-01 00:01:00+00'
)$$, 'the second transient result is recorded');
SELECT is(
  (SELECT next_attempt_at FROM public.email_deliveries WHERE id = (SELECT delivery_id FROM second_claim)),
  '2000-01-01 00:06:00+00'::timestamptz,
  'second transient failure retries after five minutes'
);

CREATE TEMP TABLE third_claim AS
SELECT * FROM public.claim_due_email_deliveries(10, 120);
SELECT is((SELECT attempt_number FROM third_claim), 3, 'the next retry is attempt three');
SELECT lives_ok($$SELECT public.record_email_delivery_result(
  (SELECT delivery_id FROM third_claim), (SELECT claim_token FROM third_claim),
  'transient_failure', NULL, 'provider_unavailable', '2000-01-01 00:06:00+00'
)$$, 'the third transient result is recorded');
SELECT is(
  (SELECT next_attempt_at FROM public.email_deliveries WHERE id = (SELECT delivery_id FROM third_claim)),
  '2000-01-01 00:21:00+00'::timestamptz,
  'third transient failure retries after fifteen minutes'
);

CREATE TEMP TABLE fourth_claim AS
SELECT * FROM public.claim_due_email_deliveries(10, 120);
SELECT is((SELECT attempt_number FROM fourth_claim), 4, 'the final send is attempt four');
SELECT lives_ok($$SELECT public.record_email_delivery_result(
  (SELECT delivery_id FROM fourth_claim), (SELECT claim_token FROM fourth_claim),
  'transient_failure', NULL, 'provider_unavailable', '2000-01-01 00:21:00+00'
)$$, 'the final transient result is recorded');
SELECT is(
  (SELECT state FROM public.email_deliveries WHERE id = (SELECT delivery_id FROM fourth_claim)),
  'failed',
  'a fourth transient failure becomes terminal instead of retrying forever'
);

SELECT lives_ok($$SELECT public.enqueue_email_delivery(
  '72000000-0000-0000-0000-000000000001',
  'fixture-success-001', 'workspace_invite', '1', 'fixture:invite:two',
  'bounce-target@example.test', '2000-01-01 00:00:00+00'
)$$, 'a second fixture delivery is enqueued');
CREATE TEMP TABLE success_claim AS
SELECT * FROM public.claim_due_email_deliveries(10, 120);
SELECT is((SELECT count(*)::int FROM success_claim), 1, 'the success fixture is claimed once');
SELECT lives_ok($$SELECT public.record_email_delivery_result(
  (SELECT delivery_id FROM success_claim), (SELECT claim_token FROM success_claim),
  'sent', 'resend-email-001', NULL, '2000-01-01 01:00:00+00'
)$$, 'provider acceptance is recorded');
SELECT is(
  (SELECT state FROM public.email_deliveries WHERE id = (SELECT delivery_id FROM success_claim)),
  'sent',
  'provider acceptance records the provider id and sent state'
);

SELECT lives_ok($$SELECT public.record_email_delivery_webhook_event(
  'provider-event-delivered', 'resend-email-001', 'delivered',
  '2000-01-01 01:10:00+00', NULL
)$$, 'a delivered webhook event is recorded');
SELECT is(
  (SELECT state FROM public.email_deliveries WHERE provider_email_id = 'resend-email-001'),
  'delivered',
  'a verified delivered event advances current state'
);
SELECT ok(
  (SELECT applied FROM public.email_delivery_events WHERE provider_event_id = 'provider-event-delivered'),
  'the advancing provider event is marked applied'
);
SELECT is(
  (SELECT terminal_at FROM public.email_deliveries WHERE provider_email_id = 'resend-email-001'),
  '2000-01-01 01:10:00+00'::timestamptz,
  'successful delivery starts the retention window'
);

SELECT lives_ok($$SELECT public.record_email_delivery_webhook_event(
  'provider-event-delayed-old', 'resend-email-001', 'delayed',
  '2000-01-01 01:05:00+00', NULL
)$$, 'an out-of-order event is accepted');
SELECT is(
  (SELECT state FROM public.email_deliveries WHERE provider_email_id = 'resend-email-001'),
  'delivered',
  'an older delayed event cannot regress delivered state'
);
SELECT ok(
  NOT (SELECT applied FROM public.email_delivery_events WHERE provider_event_id = 'provider-event-delayed-old'),
  'the out-of-order event is retained but marked unapplied'
);
SELECT lives_ok($$SELECT public.record_email_delivery_webhook_event(
  'provider-event-delivered', 'resend-email-001', 'delivered',
  '2000-01-01 01:10:00+00', NULL
)$$, 'a duplicate event is acknowledged');
SELECT is(
  (SELECT count(*)::int FROM public.email_delivery_events WHERE provider_event_id = 'provider-event-delivered'),
  1,
  'provider event replay is a successful deduplicated no-op'
);

SELECT lives_ok($$SELECT public.enqueue_email_delivery(
  '72000000-0000-0000-0000-000000000001',
  'fixture-provider-delayed-001', 'workspace_invite', '1', 'fixture:invite:delayed',
  'delayed@example.test', '2000-01-01 00:00:00+00'
)$$, 'a provider-delayed fixture is enqueued');
CREATE TEMP TABLE delayed_claim AS
SELECT * FROM public.claim_due_email_deliveries(10, 120);
SELECT lives_ok($$SELECT public.record_email_delivery_result(
  (SELECT delivery_id FROM delayed_claim), (SELECT claim_token FROM delayed_claim),
  'sent', 'resend-email-delayed-001', NULL, '2000-01-01 01:00:00+00'
)$$, 'the provider-delayed fixture is accepted by the provider');
SELECT lives_ok($$SELECT public.record_email_delivery_webhook_event(
  'provider-event-delayed-current', 'resend-email-delayed-001', 'delayed',
  '2000-01-01 01:05:00+00', NULL
)$$, 'a current provider delivery-delay event is recorded');
SELECT is(
  (SELECT state FROM public.email_deliveries WHERE provider_email_id = 'resend-email-delayed-001'),
  'delayed',
  'provider delivery delay remains visible while awaiting a later provider event'
);
SELECT is(
  (SELECT count(*)::int FROM public.claim_due_email_deliveries(10, 120)),
  0,
  'provider delivery delay does not cause a duplicate provider send'
);

SELECT lives_ok($$SELECT public.record_email_delivery_webhook_event(
  'provider-event-bounced', 'resend-email-001', 'bounced',
  '2000-01-01 01:20:00+00', NULL
)$$, 'a bounced event is recorded');
SELECT is(
  (SELECT state FROM public.email_deliveries WHERE provider_email_id = 'resend-email-001'),
  'bounced',
  'a bounce is terminal'
);
SELECT is(
  (SELECT count(*)::int FROM public.email_suppressions WHERE company_id = '72000000-0000-0000-0000-000000000001' AND active),
  1,
  'bounce creates an active company-scoped suppression'
);

SELECT lives_ok($$SELECT public.enqueue_email_delivery(
  '72000000-0000-0000-0000-000000000001',
  'fixture-suppressed-001', 'workspace_invite', '1', 'fixture:invite:three',
  'bounce-target@example.test', '2000-01-01 00:00:00+00'
)$$, 'enqueueing a suppressed recipient is a safe terminal operation');
SELECT is(
  (SELECT state FROM public.email_deliveries WHERE idempotency_key = 'fixture-suppressed-001'),
  'suppressed',
  'a newly queued email to a suppressed recipient is terminal immediately'
);
SELECT is(
  (SELECT count(*)::int FROM public.claim_due_email_deliveries(10, 120)),
  0,
  'suppressed and bounced deliveries are never retried automatically'
);

SELECT lives_ok(
  $$SELECT public.purge_terminal_email_delivery_pii('2001-01-01 00:00:00+00')$$,
  'the service retention job can purge terminal PII after 90 days'
);
SELECT is(
  (SELECT count(*)::int FROM public.email_deliveries WHERE recipient_email LIKE 'purged-%@invalid.test'),
  2,
  'terminal delivery recipient addresses are replaced with non-identifying placeholders'
);

SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.email_delivery_owner_status WHERE company_id = '72000000-0000-0000-0000-000000000001'),
  4,
  'workspace Owner sees only safe status rows for the workspace'
);
SELECT is(
  (SELECT count(*)::int FROM public.email_delivery_owner_status WHERE owner_status = 'Not delivered'),
  3,
  'terminal failures are shown to the Owner as Not delivered'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.email_delivery_owner_status),
  0,
  'non-Owner members cannot read delivery status'
);
SELECT throws_ok(
  $$SELECT recipient_email FROM public.email_deliveries$$,
  '42501', NULL,
  'authenticated users cannot read recipient addresses'
);
SELECT is(
  (SELECT count(*)::int FROM public.email_delivery_attempts),
  0,
  'non-Owner members cannot inspect attempts'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.email_delivery_owner_status WHERE company_id = '72000000-0000-0000-0000-000000000001'),
  0,
  'an Owner of another company cannot see company A status'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
