BEGIN;
SELECT plan(64);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('71000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'identity-owner-a1@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'identity-owner-a2@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'identity-admin-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'identity-member-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'identity-target-a@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'identity-owner-b@example.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'identity-invalid@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by)
VALUES
  ('72000000-0000-0000-0000-000000000001', 'Identity Company A', '71000000-0000-0000-0000-000000000001'),
  ('72000000-0000-0000-0000-000000000002', 'Identity Company B', '71000000-0000-0000-0000-000000000006'),
  ('72000000-0000-0000-0000-000000000003', 'Identity Company C', '71000000-0000-0000-0000-000000000006');

INSERT INTO public.company_memberships (id, company_id, user_id, role, status)
VALUES
  ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'owner', 'active'),
  ('73000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'owner', 'active'),
  ('73000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000003', 'admin', 'active'),
  ('73000000-0000-0000-0000-000000000004', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000004', 'member', 'active'),
  ('73000000-0000-0000-0000-000000000006', '72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000006', 'owner', 'active'),
  ('73000000-0000-0000-0000-000000000007', '72000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000007', 'owner', 'active');

SELECT has_table('public', 'company_membership_events', 'membership events table exists');
SELECT has_table('public', 'company_principals', 'company principals table exists');
SELECT has_table('public', 'company_policy_decisions', 'policy decisions table exists');
SELECT has_function(
  'public',
  'transition_company_membership',
  ARRAY['uuid', 'uuid', 'text', 'text'],
  'checked membership transition function exists'
);
SELECT has_function(
  'public',
  'bootstrap_company_owner',
  ARRAY['uuid', 'uuid'],
  'service-only owner bootstrap function exists'
);
SELECT has_function(
  'identity_private',
  'lock_company_membership_change',
  ARRAY[]::TEXT[],
  'membership writes share a company lock with principal validation'
);

SELECT ok(
  position(
    'PERFORM company.id' IN pg_get_functiondef(
      'identity_private.transition_company_membership(uuid,uuid,text,text)'::regprocedure
    )
  ) < position(
    'SELECT membership.role' IN pg_get_functiondef(
      'identity_private.transition_company_membership(uuid,uuid,text,text)'::regprocedure
    )
  ),
  'membership transitions lock the company before reading actor authority'
);

SELECT ok(
  position(
    'FOR UPDATE' IN pg_get_functiondef(
      'identity_private.validate_company_principal()'::regprocedure
    )
  ) > 0,
  'active principal validation locks the company before checking delegation'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.company_principals
    WHERE principal_type = 'user'
      AND company_id IN (
        '72000000-0000-0000-0000-000000000001',
        '72000000-0000-0000-0000-000000000002',
        '72000000-0000-0000-0000-000000000003'
      )
  ),
  6,
  'membership inserts create synchronized user principals'
);

SELECT lives_ok(
  $$INSERT INTO public.company_principals (
      id, company_id, principal_type, principal_key, display_name,
      state, capabilities, delegated_by_user_id
    ) VALUES (
      '74000000-0000-0000-0000-000000000001',
      '72000000-0000-0000-0000-000000000001',
      'agent',
      'procurement-agent',
      'Procurement Agent',
      'active',
      ARRAY['company.context.read', 'workflow.read', 'workflow.run'],
      '71000000-0000-0000-0000-000000000001'
    )$$,
  'a non-human principal can persist explicit capabilities'
);

SELECT throws_ok(
  $$INSERT INTO public.company_principals (
      company_id, principal_type, state, capabilities
    ) VALUES (
      '72000000-0000-0000-0000-000000000001',
      'integration',
      'active',
      ARRAY['workflow.read']
    )$$,
  '23514',
  NULL,
  'non-human principals require a stable principal key'
);

SELECT throws_ok(
  $$INSERT INTO public.company_principals (
      company_id, principal_type, principal_key, state, capabilities
    ) VALUES (
      '72000000-0000-0000-0000-000000000001',
      'integration',
      'missing-delegator',
      'active',
      ARRAY['workflow.read']
    )$$,
  '23514',
  NULL,
  'active non-human principals require a delegating user'
);

SELECT throws_ok(
  $$INSERT INTO public.company_principals (
      company_id, principal_type, principal_key, state, capabilities,
      delegated_by_user_id
    ) VALUES (
      '72000000-0000-0000-0000-000000000001',
      'agent',
      'duplicate-capability-agent',
      'active',
      ARRAY['workflow.read', 'workflow.read'],
      '71000000-0000-0000-0000-000000000001'
    )$$,
  '23514',
  NULL,
  'principal capabilities cannot contain duplicates'
);

SELECT throws_ok(
  $$INSERT INTO public.company_principals (
      company_id, principal_type, principal_key, state, capabilities,
      delegated_by_user_id
    ) VALUES (
      '72000000-0000-0000-0000-000000000001',
      'integration',
      'cross-company-delegation',
      'active',
      ARRAY['workflow.read'],
      '71000000-0000-0000-0000-000000000006'
    )$$,
  '23514',
  NULL,
  'principal delegation cannot cross company boundaries'
);

SELECT lives_ok(
  $$INSERT INTO public.company_policy_decisions (
      id, company_id, principal_id, permission, execution_mode,
      effect, reason, policy_version, evaluation_key,
      principal_snapshot, evaluation_context
    ) VALUES (
      '75000000-0000-0000-0000-000000000001',
      '72000000-0000-0000-0000-000000000001',
      '74000000-0000-0000-0000-000000000001',
      'workflow.run',
      'mock',
      'allow',
      'policy_satisfied',
      'identity-v1',
      repeat('a', 64),
      '{"principalType":"agent","state":"active","capabilities":["company.context.read","workflow.read","workflow.run"]}',
      '{"approval":{"required":false,"status":"not_required","warningsPresent":false,"warningsAcknowledged":false}}'
    )$$,
  'a structured policy decision can be persisted'
);

SELECT throws_ok(
  $$INSERT INTO public.company_policy_decisions (
      company_id, principal_id, permission, execution_mode,
      effect, reason, policy_version, evaluation_key,
      principal_snapshot, evaluation_context
    ) VALUES (
      '72000000-0000-0000-0000-000000000002',
      '74000000-0000-0000-0000-000000000001',
      'workflow.run',
      'mock',
      'allow',
      'policy_satisfied',
      'identity-v1',
      repeat('b', 64),
      '{"principalType":"agent","state":"active","capabilities":["workflow.run"]}',
      '{"approval":{"required":false,"status":"not_required","warningsPresent":false,"warningsAcknowledged":false}}'
    )$$,
  '23503',
  NULL,
  'policy decisions cannot reference another company principal'
);

UPDATE public.company_principals
SET state = 'disabled'
WHERE id = '74000000-0000-0000-0000-000000000001';

SELECT is(
  (
    SELECT principal_snapshot ->> 'state'
    FROM public.company_policy_decisions
    WHERE id = '75000000-0000-0000-0000-000000000001'
  ),
  'active',
  'policy decisions retain the evaluated principal snapshot'
);

SELECT throws_ok(
  $$INSERT INTO public.company_policy_decisions (
      company_id, principal_id, permission, execution_mode,
      effect, reason, policy_version, evaluation_key,
      principal_snapshot, evaluation_context
    ) VALUES (
      '72000000-0000-0000-0000-000000000001',
      '74000000-0000-0000-0000-000000000001',
      'workflow.read',
      'mock',
      'allow',
      'policy_satisfied',
      'identity-v1',
      repeat('a', 64),
      '{"principalType":"agent","state":"disabled","capabilities":["workflow.read"]}',
      '{"approval":{"required":false,"status":"not_required","warningsPresent":false,"warningsAcknowledged":false}}'
    )$$,
  '23505',
  NULL,
  'policy evaluation keys are idempotent'
);

SELECT throws_ok(
  $$UPDATE public.company_policy_decisions
    SET reason = 'permission_missing'
    WHERE id = '75000000-0000-0000-0000-000000000001'$$,
  '55000',
  NULL,
  'persisted policy decisions cannot be updated'
);

SELECT throws_ok(
  $$DELETE FROM public.company_policy_decisions
    WHERE id = '75000000-0000-0000-0000-000000000001'$$,
  '55000',
  NULL,
  'persisted policy decisions cannot be deleted'
);

SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000005',
      'invite',
      'viewer'
    )$$,
  '42501',
  NULL,
  'ordinary members cannot manage memberships'
);

SELECT throws_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000099',
      '71000000-0000-0000-0000-000000000005',
      'invite',
      'viewer'
    )$$,
  '42501',
  NULL,
  'unauthorized callers cannot distinguish missing companies'
);

SELECT is(
  (SELECT count(*)::int FROM public.company_memberships),
  1,
  'non-admin members can read only their own membership'
);

SELECT is(
  public.has_company_role(
    '72000000-0000-0000-0000-000000000001',
    'misspelled-role'
  ),
  false,
  'unknown minimum roles fail closed'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000005',
      'invite',
      'viewer'
    )$$,
  'admins can invite a non-owner membership'
);

SELECT is(
  (SELECT status FROM public.company_memberships WHERE user_id = '71000000-0000-0000-0000-000000000005'),
  'invited',
  'invited membership state is durable'
);

SELECT is(
  (
    SELECT principal.state
    FROM public.company_principals principal
    JOIN public.company_memberships membership ON membership.id = principal.membership_id
    WHERE membership.user_id = '71000000-0000-0000-0000-000000000005'
  ),
  'disabled',
  'invited user principal stays disabled'
);

SELECT throws_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000005',
      'change_role',
      'owner'
    )$$,
  '42501',
  NULL,
  'admins cannot grant owner authority'
);

SELECT lives_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000005',
      'activate',
      NULL
    )$$,
  'admins can activate invited memberships'
);

SELECT is(
  (
    SELECT principal.state
    FROM public.company_principals principal
    JOIN public.company_memberships membership ON membership.id = principal.membership_id
    WHERE membership.user_id = '71000000-0000-0000-0000-000000000005'
  ),
  'active',
  'active membership synchronizes the user principal'
);

RESET ROLE;
INSERT INTO public.company_principals (
  company_id,
  principal_type,
  principal_key,
  state,
  capabilities,
  delegated_by_user_id
)
VALUES (
  '72000000-0000-0000-0000-000000000001',
  'integration',
  'target-user-integration',
  'active',
  ARRAY['workflow.read'],
  '71000000-0000-0000-0000-000000000005'
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000005',
      'change_role',
      'member'
    )$$,
  'admins can change non-owner roles'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.company_membership_events
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND action <> 'bootstrap'
  ),
  3,
  'successful transitions create immutable membership events'
);

SELECT throws_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000001',
      'disable',
      NULL
    )$$,
  '42501',
  NULL,
  'admins cannot manage owner memberships'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000005',
      'change_role',
      'owner'
    )$$,
  'owners can grant owner authority'
);

SELECT lives_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000002',
      'disable',
      NULL
    )$$,
  'an owner can disable another owner while owners remain'
);

SELECT is(
  (SELECT status FROM public.company_memberships WHERE user_id = '71000000-0000-0000-0000-000000000002'),
  'disabled',
  'disabled owner state is durable'
);

SELECT lives_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000002',
      'remove',
      NULL
    )$$,
  'an owner can remove a disabled owner'
);

SELECT is(
  (SELECT status FROM public.company_memberships WHERE user_id = '71000000-0000-0000-0000-000000000002'),
  'removed',
  'removed owner state is durable'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000005', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000005',
      'leave',
      NULL
    )$$,
  'an owner may leave while another active owner remains'
);

SELECT is(
  (SELECT status FROM public.company_memberships WHERE user_id = '71000000-0000-0000-0000-000000000005'),
  'disabled',
  'self-leave disables the membership and principal'
);

RESET ROLE;
SELECT is(
  (
    SELECT state
    FROM public.company_principals
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND principal_key = 'target-user-integration'
  ),
  'disabled',
  'revoking a delegator disables their non-human principals'
);

RESET ROLE;
SELECT throws_ok(
  $$INSERT INTO public.company_principals (
      company_id, principal_type, principal_key, state, capabilities,
      delegated_by_user_id
    ) VALUES (
      '72000000-0000-0000-0000-000000000001',
      'integration',
      'inactive-delegation',
      'active',
      ARRAY['workflow.read'],
      '71000000-0000-0000-0000-000000000005'
    )$$,
  '23514',
  NULL,
  'non-human principals require an active company delegator'
);

SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000001',
      'leave',
      NULL
    )$$,
  '55000',
  NULL,
  'the last active owner cannot leave'
);

SELECT throws_ok(
  $$SELECT public.transition_company_membership(
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000001',
      'change_role',
      'member'
    )$$,
  '55000',
  NULL,
  'the last active owner cannot be demoted'
);

RESET ROLE;
SELECT throws_ok(
  $$UPDATE public.company_memberships
    SET role = 'member'
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND user_id = '71000000-0000-0000-0000-000000000001'$$,
  '55000',
  NULL,
  'direct writes cannot demote the final active owner'
);

SELECT throws_ok(
  $$DELETE FROM public.company_memberships
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
      AND user_id = '71000000-0000-0000-0000-000000000001'$$,
  '55000',
  NULL,
  'direct deletes cannot remove the final active owner'
);

SELECT throws_ok(
  $$DELETE FROM auth.users
    WHERE id = '71000000-0000-0000-0000-000000000007'$$,
  '55000',
  NULL,
  'user deletion cannot cascade away a final active owner'
);

INSERT INTO public.company_policy_decisions (
  company_id,
  principal_id,
  permission,
  execution_mode,
  effect,
  reason,
  policy_version,
  evaluation_key,
  principal_snapshot,
  evaluation_context
)
SELECT
  '72000000-0000-0000-0000-000000000003',
  principal.id,
  'company.context.read',
  'mock',
  'allow',
  'policy_satisfied',
  'identity-v1',
  repeat('c', 64),
  '{"principalType":"user","state":"active","role":"owner"}',
  '{"approval":{"required":false,"status":"not_required","warningsPresent":false,"warningsAcknowledged":false}}'
FROM public.company_principals principal
WHERE principal.company_id = '72000000-0000-0000-0000-000000000003'
  AND principal.principal_type = 'user';

SELECT lives_ok(
  $$DELETE FROM public.companies
    WHERE id = '72000000-0000-0000-0000-000000000003'$$,
  'deleting a company can cascade its final owner membership intentionally'
);

SELECT is(
  (
    SELECT
      (SELECT count(*) FROM public.company_memberships WHERE company_id = '72000000-0000-0000-0000-000000000003')
      + (SELECT count(*) FROM public.company_membership_events WHERE company_id = '72000000-0000-0000-0000-000000000003')
      + (SELECT count(*) FROM public.company_principals WHERE company_id = '72000000-0000-0000-0000-000000000003')
      + (SELECT count(*) FROM public.company_policy_decisions WHERE company_id = '72000000-0000-0000-0000-000000000003')
  )::int,
  0,
  'company deletion cascades immutable identity and authorization records'
);

SELECT throws_ok(
  $$INSERT INTO public.company_memberships (
      company_id, user_id, role, status
    ) VALUES (
      '72000000-0000-0000-0000-000000000001',
      '71000000-0000-0000-0000-000000000007',
      'viewer',
      'unknown'
    )$$,
  '23514',
  NULL,
  'membership status remains constrained'
);

SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.company_principals),
  7,
  'members see principals only in their company'
);

SELECT is(
  (SELECT count(*)::int FROM public.company_policy_decisions),
  1,
  'members can inspect structured policy decisions in their company'
);

SELECT is(
  (SELECT count(*)::int FROM public.company_membership_events),
  0,
  'ordinary members cannot inspect membership administration events'
);

RESET ROLE;
SELECT throws_ok(
  $$UPDATE public.company_membership_events
    SET action = 'disable'
    WHERE id = (SELECT id FROM public.company_membership_events LIMIT 1)$$,
  '55000',
  NULL,
  'membership events cannot be updated'
);

SELECT throws_ok(
  $$DELETE FROM public.company_membership_events
    WHERE id = (SELECT id FROM public.company_membership_events LIMIT 1)$$,
  '55000',
  NULL,
  'membership events cannot be deleted'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.company_policy_decisions', 'INSERT'),
  'authenticated clients cannot forge policy decisions'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.company_memberships', 'UPDATE'),
  'authenticated clients cannot bypass membership transition RPCs'
);

SELECT ok(
  NOT has_table_privilege('service_role', 'public.company_memberships', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.company_memberships', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.company_memberships', 'DELETE'),
  'service clients must use checked membership RPCs'
);

SELECT ok(
  NOT has_table_privilege('service_role', 'public.company_policy_decisions', 'UPDATE'),
  'service clients cannot rewrite policy decisions'
);

SELECT ok(
  NOT has_table_privilege('service_role', 'public.company_policy_decisions', 'DELETE'),
  'service clients cannot delete policy decisions'
);

SELECT ok(
  NOT has_table_privilege('service_role', 'public.company_membership_events', 'INSERT'),
  'service clients cannot forge membership events'
);

SELECT ok(
  NOT has_table_privilege('service_role', 'public.company_membership_events', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.company_membership_events', 'DELETE'),
  'service clients cannot mutate membership events'
);

SELECT set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.company_membership_events),
  7,
  'admins can inspect all successful membership events for their company'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.company_memberships
    WHERE company_id = '72000000-0000-0000-0000-000000000001'
  ),
  5,
  'admins can read peer memberships without recursive RLS'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
