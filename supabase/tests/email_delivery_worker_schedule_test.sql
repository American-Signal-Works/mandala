BEGIN;
SELECT plan(8);

SELECT has_function(
  'email_private',
  'invoke_email_delivery_worker',
  ARRAY[]::TEXT[],
  'private scheduled worker invocation exists'
);
SELECT is(
  has_function_privilege(
    'anon',
    'email_private.invoke_email_delivery_worker()',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot invoke the worker schedule function'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'email_private.invoke_email_delivery_worker()',
    'EXECUTE'
  ),
  false,
  'members cannot invoke the worker schedule function'
);
SELECT is(
  has_function_privilege(
    'service_role',
    'email_private.invoke_email_delivery_worker()',
    'EXECUTE'
  ),
  false,
  'service clients cannot invoke the worker schedule function directly'
);
SELECT is(
  email_private.invoke_email_delivery_worker(),
  NULL::BIGINT,
  'missing Vault configuration fails closed without a network request'
);
SELECT is(
  (
    SELECT schedule
    FROM cron.job
    WHERE jobname = 'invoke-email-delivery-worker'
  ),
  '* * * * *',
  'worker schedule runs once per minute'
);
SELECT is(
  (
    SELECT active
    FROM cron.job
    WHERE jobname = 'invoke-email-delivery-worker'
  ),
  true,
  'worker schedule is active'
);
SELECT is(
  (
    SELECT command
    FROM cron.job
    WHERE jobname = 'invoke-email-delivery-worker'
  ),
  'SELECT email_private.invoke_email_delivery_worker()',
  'cron stores only the private function call, never a bearer value'
);

SELECT * FROM finish();
ROLLBACK;

