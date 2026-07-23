CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE FUNCTION email_private.invoke_email_delivery_worker()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  worker_url TEXT;
  worker_secret TEXT;
  request_id BIGINT;
BEGIN
  SELECT secret.decrypted_secret INTO worker_url
  FROM vault.decrypted_secrets secret
  WHERE secret.name = 'email_delivery_worker_url';

  SELECT secret.decrypted_secret INTO worker_secret
  FROM vault.decrypted_secrets secret
  WHERE secret.name = 'email_delivery_worker_secret';

  -- Local, preview, and newly provisioned projects must fail closed. Operators
  -- opt production into delivery by configuring both Vault values.
  IF COALESCE(trim(worker_url), '') = ''
    OR COALESCE(trim(worker_secret), '') = ''
  THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := worker_url,
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || worker_secret,
      'content-type', 'application/json'
    ),
    body := '{"limit":25}'::JSONB,
    timeout_milliseconds := 10000
  ) INTO request_id;

  RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION email_private.invoke_email_delivery_worker()
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION email_private.invoke_email_delivery_worker() IS
  'Invokes the bearer-protected email delivery worker using URL and secret values stored in Supabase Vault. Missing configuration is a safe no-op.';

DO $$
DECLARE
  existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'invoke-email-delivery-worker';

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'invoke-email-delivery-worker',
    '* * * * *',
    $job$SELECT email_private.invoke_email_delivery_worker()$job$
  );
END;
$$;

