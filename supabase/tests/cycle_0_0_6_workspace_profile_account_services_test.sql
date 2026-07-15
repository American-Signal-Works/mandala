BEGIN;
SELECT no_plan();

SELECT has_column('public', 'profiles', 'first_name', 'profiles have canonical first names');
SELECT has_column('public', 'profiles', 'last_name', 'profiles have canonical last names');
SELECT has_column('public', 'profiles', 'version', 'profiles have conflict versions');
SELECT has_column('public', 'companies', 'logo_path', 'companies have private logo paths');
SELECT has_column('public', 'companies', 'created_by_snapshot', 'company creator audit identity is preserved');
SELECT has_table('public', 'account_deletion_requests', 'account deletion has durable recovery state');
SELECT has_function('public', 'create_company_with_owner', ARRAY['text'], 'atomic workspace bootstrap exists');
SELECT has_function(
  'public',
  'update_my_profile_identity',
  ARRAY['text', 'text', 'text', 'text', 'text', 'bigint'],
  'versioned profile identity update exists'
);
SELECT has_function('public', 'preflight_account_deletion', ARRAY[]::TEXT[], 'safe deletion preflight exists');

SELECT is(
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'avatars'),
  5242880::BIGINT,
  'avatar bucket is capped at five megabytes'
);
SELECT is(
  (SELECT allowed_mime_types FROM storage.buckets WHERE id = 'workspace-logos'),
  ARRAY['image/png', 'image/jpeg']::TEXT[],
  'workspace logo bucket accepts only PNG and JPEG'
);
SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'workspace-logos'),
  false,
  'workspace logos remain private'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('81000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'profile-owner@example.test', '', now(), '{}', '{}', now(), now()),
  ('81000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other-owner@example.test', '', now(), '{}', '{}', now(), now()),
  ('81000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'final-owner@example.test', '', now(), '{}', '{}', now(), now()),
  ('81000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'audit-creator@example.test', '', now(), '{}', '{}', now(), now());

SELECT set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.update_my_profile_identity(
      'Ada',
      'Lovelace',
      'Ada Lovelace',
      'UTC',
      NULL,
      1
    )$$,
  'a user can complete their own required identity'
);
SELECT is(
  (SELECT first_name FROM public.profiles WHERE user_id = '81000000-0000-4000-8000-000000000001'),
  'Ada',
  'canonical first name is stored'
);
SELECT is(
  (SELECT version FROM public.profiles WHERE user_id = '81000000-0000-4000-8000-000000000001'),
  2::BIGINT,
  'identity update advances the conflict version'
);
SELECT throws_ok(
  $$SELECT public.update_my_profile_identity(
      'Ada',
      'Byron',
      'Ada Byron',
      'UTC',
      NULL,
      1
    )$$,
  '40001',
  NULL,
  'a stale profile save fails instead of overwriting'
);
SELECT throws_ok(
  $$UPDATE public.profiles
    SET first_name = 'Bypass'
    WHERE user_id = '81000000-0000-4000-8000-000000000001'$$,
  '42501',
  NULL,
  'identity columns cannot bypass the checked service'
);
SELECT throws_ok(
  $$UPDATE public.profiles
    SET theme_mode = 'dark'
    WHERE user_id = '81000000-0000-4000-8000-000000000001'$$,
  '42501',
  NULL,
  'theme columns cannot bypass the versioned preference service'
);

SELECT set_config(
  'test.created_workspace',
  (public.create_company_with_owner('  Atomic Workspace  ') ->> 'id'),
  true
);

RESET ROLE;
SELECT is(
  (SELECT name FROM public.companies WHERE id = current_setting('test.created_workspace')::UUID),
  'Atomic Workspace',
  'workspace names are normalized during bootstrap'
);
SELECT is(
  (
    SELECT role
    FROM public.company_memberships
    WHERE company_id = current_setting('test.created_workspace')::UUID
      AND user_id = '81000000-0000-4000-8000-000000000001'
      AND status = 'active'
  ),
  'owner',
  'workspace and initial active Owner are created atomically'
);

INSERT INTO public.company_memberships (company_id, user_id, role, status)
VALUES (
  current_setting('test.created_workspace')::UUID,
  '81000000-0000-4000-8000-000000000002',
  'owner',
  'active'
);

UPDATE public.company_memberships
SET status = 'disabled'
WHERE company_id = current_setting('test.created_workspace')::UUID
  AND user_id = '81000000-0000-4000-8000-000000000001';

SET LOCAL ROLE authenticated;
SELECT is(
  (
    SELECT count(*)::INT
    FROM public.companies
    WHERE id = current_setting('test.created_workspace')::UUID
  ),
  0,
  'a removed or disabled creator cannot read through created_by'
);
SELECT throws_ok(
  $$INSERT INTO public.companies (name, created_by)
    VALUES ('Unsafe split bootstrap', '81000000-0000-4000-8000-000000000001')$$,
  '42501',
  NULL,
  'authenticated callers cannot create a company without its Owner transaction'
);

RESET ROLE;
UPDATE public.company_memberships
SET status = 'active'
WHERE company_id = current_setting('test.created_workspace')::UUID
  AND user_id = '81000000-0000-4000-8000-000000000001';

INSERT INTO public.companies (id, name, created_by)
VALUES (
  '82000000-0000-4000-8000-000000000003',
  'Final Owner Workspace',
  '81000000-0000-4000-8000-000000000003'
);
INSERT INTO public.company_memberships (company_id, user_id, role, status)
VALUES (
  '82000000-0000-4000-8000-000000000003',
  '81000000-0000-4000-8000-000000000003',
  'owner',
  'active'
);

SELECT set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  $$SELECT public.preflight_account_deletion()$$,
  'account deletion preflight passes when another active Owner remains'
);
SELECT is(
  (
    SELECT status
    FROM public.account_deletion_requests
    WHERE user_id = '81000000-0000-4000-8000-000000000001'
  ),
  'preflight_passed',
  'successful preflight records recoverable deletion state'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT is(
  public.revoke_account_memberships_for_deletion(
    '81000000-0000-4000-8000-000000000001'
  ),
  1,
  'deletion access revocation transitions every remaining membership'
);
RESET ROLE;
SELECT is(
  (
    SELECT status
    FROM public.company_memberships
    WHERE company_id = current_setting('test.created_workspace')::UUID
      AND user_id = '81000000-0000-4000-8000-000000000001'
  ),
  'removed',
  'deletion revocation removes active workspace access immediately'
);
SELECT is(
  (
    SELECT count(*)::INT
    FROM public.company_membership_events
    WHERE company_id = current_setting('test.created_workspace')::UUID
      AND target_user_id = '81000000-0000-4000-8000-000000000001'
      AND actor_user_id = '81000000-0000-4000-8000-000000000001'
      AND action = 'remove'
      AND previous_status = 'active'
      AND next_status = 'removed'
  ),
  1,
  'deletion revocation preserves one immutable removal event with attribution'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.preflight_account_deletion()$$,
  '23514',
  NULL,
  'final Owners are blocked before destructive deletion work'
);
SELECT is(
  (
    SELECT count(*)::INT
    FROM public.account_deletion_requests
    WHERE user_id = '81000000-0000-4000-8000-000000000003'
  ),
  0,
  'blocked preflight does not start a deletion saga'
);

RESET ROLE;
INSERT INTO public.companies (id, name, created_by)
VALUES (
  '82000000-0000-4000-8000-000000000004',
  'Creator Audit Workspace',
  '81000000-0000-4000-8000-000000000004'
);
DELETE FROM auth.users WHERE id = '81000000-0000-4000-8000-000000000004';
SELECT is(
  (SELECT created_by FROM public.companies WHERE id = '82000000-0000-4000-8000-000000000004'),
  NULL::UUID,
  'Auth deletion no longer fails on historical company creator linkage'
);
SELECT is(
  (SELECT created_by_snapshot FROM public.companies WHERE id = '82000000-0000-4000-8000-000000000004'),
  '81000000-0000-4000-8000-000000000004'::UUID,
  'immutable creator attribution survives Auth deletion'
);

SELECT * FROM finish();
ROLLBACK;
