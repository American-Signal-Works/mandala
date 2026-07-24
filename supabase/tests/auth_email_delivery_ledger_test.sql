BEGIN;
SELECT plan(39);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'auth-owner@example.test', '', now(), '{}', '{}', now(), now()),
  ('81000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'auth-member@example.test', '', now(), '{}', '{}', now(), now()),
  ('81000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'platform-user@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by)
VALUES (
  '82000000-0000-4000-8000-000000000001',
  'Auth Delivery Company',
  '81000000-0000-4000-8000-000000000001'
);

INSERT INTO public.company_memberships (company_id, user_id, role)
VALUES
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'owner'),
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'member');

SELECT has_column(
  'public',
  'email_deliveries',
  'delivery_mode',
  'logical deliveries identify worker and inline-auth transport'
);
SELECT ok(
  (
    SELECT is_nullable = 'YES'
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'email_deliveries'
      AND column_name = 'company_id'
  ),
  'a not-yet-onboarded auth delivery may be platform scoped'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.enqueue_auth_email_delivery(uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated callers cannot enqueue auth deliveries'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.claim_inline_auth_email_delivery(uuid)',
    'EXECUTE'
  ),
  'authenticated callers cannot claim inline auth deliveries'
);

SELECT lives_ok(
  $$SELECT public.enqueue_auth_email_delivery(
    '81000000-0000-4000-8000-000000000002',
    'msg_auth_known_001',
    'auth_magic_link',
    'AUTH-MEMBER@EXAMPLE.TEST'
  )$$,
  'a verified hook can enqueue a known-user auth delivery'
);
SELECT lives_ok(
  $$SELECT public.enqueue_auth_email_delivery(
    '81000000-0000-4000-8000-000000000002',
    'msg_auth_known_001',
    'auth_recovery',
    'auth-member@example.test'
  )$$,
  'replaying one hook id is a safe idempotent no-op'
);
SELECT is(
  (
    SELECT count(*)::int
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_known_001'
  ),
  1,
  'one signed hook id creates exactly one logical delivery'
);
SELECT is(
  (
    SELECT company_id
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_known_001'
  ),
  '82000000-0000-4000-8000-000000000001'::uuid,
  'the known user resolves to an active workspace'
);
SELECT is(
  (
    SELECT delivery_mode
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_known_001'
  ),
  'inline_auth',
  'auth delivery is isolated from the scheduled worker'
);
SELECT is(
  (
    SELECT template_key
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_known_001'
  ),
  'auth_magic_link',
  'a replay cannot replace the original template contract'
);
SELECT is(
  (
    SELECT payload_reference
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_known_001'
  ),
  'auth_hook:msg_auth_known_001',
  'the payload reference is the opaque signed hook id'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_known_001'
      AND (
        payload_reference ILIKE '%token%'
        OR payload_reference ILIKE '%verify%'
        OR payload_reference ILIKE '%http%'
      )
  ),
  'the ledger contains no token, verification URL, or rendered payload'
);
SELECT is(
  (
    SELECT count(*)::int
    FROM public.claim_due_email_deliveries(25, 120)
    WHERE delivery_id = (
      SELECT id
      FROM public.email_deliveries
      WHERE idempotency_key = 'auth-hook:msg_auth_known_001'
    )
  ),
  0,
  'the scheduled worker cannot claim inline auth delivery'
);

CREATE TEMP TABLE auth_known_claim_one AS
SELECT *
FROM public.claim_inline_auth_email_delivery(
  (
    SELECT id
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_known_001'
  )
);
SELECT is(
  (SELECT count(*)::int FROM auth_known_claim_one),
  1,
  'the signed hook claims its own inline delivery'
);
SELECT is(
  (SELECT attempt_number FROM auth_known_claim_one),
  1,
  'the first inline claim creates attempt one'
);
SELECT lives_ok(
  $$SELECT public.record_email_delivery_result(
    (SELECT delivery_id FROM auth_known_claim_one),
    (SELECT claim_token FROM auth_known_claim_one),
    'transient_failure',
    NULL,
    'transient_rate_limit_exceeded',
    now()
  )$$,
  'a transient inline provider result is recorded'
);

CREATE TEMP TABLE auth_known_claim_two AS
SELECT *
FROM public.claim_inline_auth_email_delivery(
  (SELECT delivery_id FROM auth_known_claim_one)
);
SELECT is(
  (SELECT attempt_number FROM auth_known_claim_two),
  2,
  'the hook can make its bounded retry without waiting for the worker schedule'
);
SELECT lives_ok(
  $$SELECT public.record_email_delivery_result(
    (SELECT delivery_id FROM auth_known_claim_two),
    (SELECT claim_token FROM auth_known_claim_two),
    'sent',
    'resend-auth-known-001',
    NULL,
    now()
  )$$,
  'provider acceptance is attached to the auth delivery'
);
SELECT is(
  (
    SELECT state
    FROM public.email_deliveries
    WHERE provider_email_id = 'resend-auth-known-001'
  ),
  'sent',
  'the logical auth delivery reaches sent'
);
SELECT lives_ok(
  $$SELECT public.record_email_delivery_webhook_event(
    'resend-event-auth-known-delivered',
    'resend-auth-known-001',
    'delivered',
    now(),
    NULL
  )$$,
  'the shared signed provider webhook accepts auth delivery events'
);
SELECT is(
  (
    SELECT state
    FROM public.email_deliveries
    WHERE provider_email_id = 'resend-auth-known-001'
  ),
  'delivered',
  'a delivered event advances the same auth delivery'
);
SELECT is(
  (
    SELECT count(*)::int
    FROM public.email_delivery_events
    WHERE provider_email_id = 'resend-auth-known-001'
  ),
  1,
  'auth provider history is durable'
);

SELECT lives_ok(
  $$SELECT public.enqueue_auth_email_delivery(
    '81000000-0000-4000-8000-000000000002',
    'msg_auth_known_002',
    'auth_recovery',
    'auth-member@example.test'
  )$$,
  'a separate recovery hook creates its own logical delivery'
);
CREATE TEMP TABLE auth_failed_claim AS
SELECT *
FROM public.claim_inline_auth_email_delivery(
  (
    SELECT id
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_known_002'
  )
);
SELECT lives_ok(
  $$SELECT public.record_email_delivery_result(
    (SELECT delivery_id FROM auth_failed_claim),
    (SELECT claim_token FROM auth_failed_claim),
    'permanent_failure',
    NULL,
    'transient_exhausted_provider_timeout',
    now()
  )$$,
  'an exhausted inline retry becomes a safe terminal result'
);

SELECT lives_ok(
  $$SELECT public.enqueue_auth_email_delivery(
    '81000000-0000-4000-8000-000000000003',
    'msg_auth_platform_001',
    'auth_magic_link',
    'platform-user@example.test'
  )$$,
  'a not-yet-onboarded user still gets a platform-scoped ledger row'
);
SELECT ok(
  (
    SELECT company_id IS NULL
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_platform_001'
  ),
  'platform-scoped auth delivery does not invent a workspace'
);
CREATE TEMP TABLE auth_platform_claim AS
SELECT *
FROM public.claim_inline_auth_email_delivery(
  (
    SELECT id
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_platform_001'
  )
);
SELECT is(
  (SELECT count(*)::int FROM auth_platform_claim),
  1,
  'the hook can claim a platform-scoped delivery'
);
SELECT lives_ok(
  $$SELECT public.record_email_delivery_result(
    (SELECT delivery_id FROM auth_platform_claim),
    (SELECT claim_token FROM auth_platform_claim),
    'sent',
    'resend-auth-platform-001',
    NULL,
    now()
  )$$,
  'platform-scoped provider acceptance is recorded'
);
SELECT lives_ok(
  $$SELECT public.record_email_delivery_webhook_event(
    'resend-event-auth-platform-complained',
    'resend-auth-platform-001',
    'complained',
    now(),
    'provider_complained'
  )$$,
  'a platform-scoped complaint reaches the shared webhook path'
);
SELECT is(
  (
    SELECT count(*)::int
    FROM public.email_suppressions
    WHERE company_id IS NULL
      AND recipient_hash = email_private.recipient_hash(
        'platform-user@example.test'
      )
      AND active
  ),
  1,
  'a platform-scoped complaint creates one global suppression'
);
SELECT lives_ok(
  $$SELECT public.enqueue_auth_email_delivery(
    '81000000-0000-4000-8000-000000000003',
    'msg_auth_platform_002',
    'auth_magic_link',
    'platform-user@example.test'
  )$$,
  'a later hook for a suppressed platform recipient is safely recorded'
);
SELECT is(
  (
    SELECT state
    FROM public.email_deliveries
    WHERE idempotency_key = 'auth-hook:msg_auth_platform_002'
  ),
  'suppressed',
  'a complained platform recipient is never resent'
);
SELECT is(
  (
    SELECT count(*)::int
    FROM public.claim_inline_auth_email_delivery(
      (
        SELECT id
        FROM public.email_deliveries
        WHERE idempotency_key = 'auth-hook:msg_auth_platform_002'
      )
    )
  ),
  0,
  'a suppressed inline delivery cannot be claimed'
);

SELECT throws_ok(
  $$SELECT public.enqueue_auth_email_delivery(
    '81000000-0000-4000-8000-000000000002',
    'msg_auth_bad_email',
    'auth_magic_link',
    'other@example.test'
  )$$,
  '22023',
  'auth recipient mismatch',
  'the service RPC rejects a user and recipient mismatch'
);
SELECT throws_ok(
  $$SELECT public.enqueue_auth_email_delivery(
    '81000000-0000-4000-8000-000000000002',
    'msg_auth_bad_template',
    'workspace_invite',
    'auth-member@example.test'
  )$$,
  '22023',
  'unsupported auth email template',
  'the service RPC rejects non-auth templates'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  (
    SELECT count(*)::int
    FROM public.email_delivery_owner_status
    WHERE company_id = '82000000-0000-4000-8000-000000000001'
  ),
  2,
  'the workspace Owner sees both safe known-user auth statuses'
);
SELECT is(
  (
    SELECT count(*)::int
    FROM public.email_delivery_owner_status
    WHERE owner_status = 'Not delivered'
  ),
  1,
  'the workspace Owner sees the terminal auth failure without PII'
);
SELECT is(
  (
    SELECT count(*)::int
    FROM public.email_delivery_owner_status
    WHERE company_id IS NULL
  ),
  0,
  'platform-scoped auth deliveries are invisible to authenticated users'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claim.sub',
  '81000000-0000-4000-8000-000000000002',
  true
);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.email_delivery_owner_status),
  0,
  'a non-Owner cannot inspect auth delivery status'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
