BEGIN;
SELECT no_plan();

SELECT has_table(
  'public',
  'cli_device_authorizations',
  'hosted CLI device requests have durable short-lived state'
);
SELECT has_table(
  'public',
  'cli_sessions',
  'issued CLI sessions have revocable API-only credential metadata'
);
SELECT has_function(
  'public',
  'create_cli_device_authorization_v1',
  ARRAY['uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text[]', 'timestamp with time zone'],
  'service-only device authorization creation exists'
);
SELECT has_function(
  'public',
  'validate_cli_session_v1',
  ARRAY['text'],
  'opaque Mandala access tokens can be validated server-side'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cli_device_authorizations'::regclass),
  true,
  'device authorization rows enforce RLS'
);
SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cli_sessions'::regclass),
  true,
  'CLI session rows enforce RLS'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'cli-owner@example.test', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'cli-other@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by)
VALUES (
  '92000000-0000-4000-8000-000000000001',
  'CLI Workspace',
  '91000000-0000-4000-8000-000000000001'
);
INSERT INTO public.company_memberships (company_id, user_id, role, status)
VALUES
  (
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'owner',
    'active'
  ),
  (
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000002',
    'owner',
    'active'
  );

SELECT is(
  has_function_privilege(
    'authenticated',
    'public.inspect_cli_device_authorization_v1(text,text,uuid)',
    'EXECUTE'
  ),
  false,
  'browser inspection cannot bypass the server-owned rate limiter'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.decide_cli_device_authorization_v1(text,text,text,uuid,uuid)',
    'EXECUTE'
  ),
  false,
  'browser decisions are service-route only'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.validate_cli_session_v1(text)',
    'EXECUTE'
  ),
  false,
  'opaque CLI token validation is not exposed through Supabase RPC'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.inspect_cli_session_refresh_v1(text)',
    'EXECUTE'
  ),
  false,
  'opaque refresh inspection is service-route only'
);

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT public.create_cli_device_authorization_v1(
      '93000000-0000-4000-8000-000000000001',
      repeat('1', 64), repeat('2', 64), repeat('3', 64),
      'Mandala CLI', '0.0.0', 'darwin-arm64',
      ARRAY['workspace:control'], now() + INTERVAL '10 minutes'
    )$$,
  'the service can create one short-lived device request'
);

SELECT is(
  public.inspect_cli_device_authorization_v1(
    repeat('9', 64), repeat('4', 64),
    '91000000-0000-4000-8000-000000000001'
  ) ->> 'error',
  'not_found',
  'failed lookups return handled results so attempt evidence commits'
);
SELECT is(
  (
    SELECT count(*)::INTEGER
    FROM public.cli_authorization_attempts
    WHERE attempt_kind = 'verification' AND subject_hash = repeat('4', 64)
  ),
  1,
  'a failed lookup still counts toward rate limiting'
);
SELECT is(
  public.inspect_cli_device_authorization_v1(
    repeat('2', 64), repeat('4', 64),
    '91000000-0000-4000-8000-000000000001'
  ) ->> 'status',
  'pending',
  'the signed-in owner can inspect the pending terminal request through the service'
);
SELECT lives_ok(
  $$SELECT public.decide_cli_device_authorization_v1(
      repeat('2', 64), repeat('4', 64), 'approve',
      '92000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001'
    )$$,
  'the service records an active member approving one workspace'
);

SELECT set_config(
  'test.cli_exchange_nonce',
  public.claim_cli_device_authorization_v1(repeat('1', 64)) ->> 'exchangeNonce',
  true
);
RESET ROLE;
INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES (
  '94000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  now(),
  now()
);
SET LOCAL ROLE service_role;
SELECT lives_ok(
  format(
    'SELECT public.complete_cli_device_authorization_v1(%L, %L, %L, %L, now() + interval ''15 minutes'', now() + interval ''30 days'', %L, %L)',
    '93000000-0000-4000-8000-000000000001',
    current_setting('test.cli_exchange_nonce'),
    repeat('5', 64),
    repeat('6', 64),
    '94000000-0000-4000-8000-000000000001',
    repeat('a', 40)
  ),
  'the exchange stores only opaque Mandala credential digests'
);
SELECT is(
  public.claim_cli_device_authorization_v1(repeat('1', 64)) ->> 'status',
  'consumed',
  'a consumed polling token cannot issue another session'
);
SELECT is(
  public.validate_cli_session_v1(repeat('5', 64)) ->> 'allowed',
  'true',
  'the issued Mandala-only access token is accepted before revocation'
);
SAVEPOINT membership_removed;
RESET ROLE;
DELETE FROM public.company_memberships
WHERE company_id = '92000000-0000-4000-8000-000000000001'
  AND user_id = '91000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT is(
  public.validate_cli_session_v1(repeat('5', 64)) ->> 'allowed',
  'false',
  'removing workspace membership immediately invalidates the CLI session'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::INTEGER FROM auth.sessions WHERE id = '94000000-0000-4000-8000-000000000001'),
  0,
  'membership removal also revokes the internal actor session'
);
ROLLBACK TO SAVEPOINT membership_removed;
SET LOCAL ROLE service_role;
SAVEPOINT actor_banned;
RESET ROLE;
UPDATE auth.users
SET banned_until = now() + INTERVAL '1 hour'
WHERE id = '91000000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT is(
  public.validate_cli_session_v1(repeat('5', 64)) ->> 'allowed',
  'false',
  'a banned user cannot continue using the CLI session'
);
RESET ROLE;
ROLLBACK TO SAVEPOINT actor_banned;
SET LOCAL ROLE service_role;
SELECT is(
  public.validate_cli_session_v1(repeat('7', 64)) ->> 'allowed',
  'false',
  'an unknown token digest is rejected'
);
RESET ROLE;
INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES (
  '95000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  now(),
  now()
);
SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT public.rotate_cli_session_credentials_v1(
      repeat('6', 64), repeat('7', 64), repeat('8', 64),
      now() + INTERVAL '15 minutes', now() + INTERVAL '30 days',
      '95000000-0000-4000-8000-000000000001', repeat('b', 40)
    )$$,
  'a valid refresh credential atomically rotates both opaque credentials'
);
SELECT is(
  public.validate_cli_session_v1(repeat('5', 64)) ->> 'allowed',
  'false',
  'the old access token stops working after rotation'
);
SELECT is(
  public.validate_cli_session_v1(repeat('7', 64)) ->> 'allowed',
  'true',
  'the rotated access token is accepted'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::INTEGER FROM auth.sessions WHERE id = '94000000-0000-4000-8000-000000000001'),
  0,
  'credential rotation revokes the previous internal actor session'
);
SET LOCAL ROLE service_role;

SELECT set_config(
  'test.cli_session_id',
  (SELECT id::TEXT FROM public.cli_sessions WHERE access_token_hash = repeat('7', 64)),
  true
);
SELECT lives_ok(
  format(
    'SELECT public.revoke_cli_session_v1(%L, %L)',
    '91000000-0000-4000-8000-000000000001',
    current_setting('test.cli_session_id')
  ),
  'the server can revoke the owner''s installed CLI session'
);
SELECT is(
  public.validate_cli_session_v1(repeat('7', 64)) ->> 'allowed',
  'false',
  'a revoked CLI session is rejected immediately'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::INTEGER FROM auth.sessions WHERE id = '95000000-0000-4000-8000-000000000001'),
  0,
  'CLI revocation also revokes the server-only actor session'
);

INSERT INTO auth.sessions (id, user_id, created_at, updated_at)
VALUES (
  '96000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  now(),
  now()
);
SET LOCAL ROLE service_role;
INSERT INTO public.cli_sessions (
  id, access_token_hash, refresh_token_hash, actor_auth_session_id,
  actor_session_ciphertext, user_id, selected_company_id, scopes,
  client_name, client_version, client_platform,
  access_expires_at, refresh_expires_at
) VALUES (
  '97000000-0000-4000-8000-000000000001',
  repeat('c', 64), repeat('d', 64),
  '96000000-0000-4000-8000-000000000001', repeat('e', 40),
  '91000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001', ARRAY['workspace:control'],
  'Mandala CLI', '0.0.0', 'darwin-arm64',
  now() + INTERVAL '15 minutes', now() + INTERVAL '30 days'
);
SELECT is(
  public.revoke_all_cli_sessions_v1('91000000-0000-4000-8000-000000000001') ->> 'revokedCount',
  '1',
  'browser account management can revoke every remaining CLI session'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::INTEGER FROM auth.sessions WHERE id = '96000000-0000-4000-8000-000000000001'),
  0,
  'revoke-all also removes each linked internal actor session'
);

SELECT * FROM finish();
ROLLBACK;
