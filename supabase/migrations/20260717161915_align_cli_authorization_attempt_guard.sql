-- Production originally raised from the attempt helper and returned void.
-- The browser-token contract needs a boolean so the API can return a bounded
-- 429 response without turning a normal rate limit into an RPC failure.

DROP FUNCTION IF EXISTS public.inspect_cli_device_authorization_v1(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.decide_cli_device_authorization_v1(TEXT, TEXT, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS cli_private.record_attempt(TEXT, TEXT, INTEGER, INTERVAL);

CREATE FUNCTION cli_private.record_attempt(
  p_attempt_kind TEXT,
  p_subject_hash TEXT,
  p_limit INTEGER,
  p_window INTERVAL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  attempt_count INTEGER;
BEGIN
  IF p_attempt_kind NOT IN ('verification', 'decision')
    OR p_subject_hash !~ '^[a-f0-9]{64}$'
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_window < INTERVAL '1 second'
    OR p_window > INTERVAL '1 day'
  THEN
    RAISE EXCEPTION 'invalid_cli_authorization_attempt' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_attempt_kind || ':' || p_subject_hash)
  );

  SELECT count(*)::INTEGER
  INTO attempt_count
  FROM public.cli_authorization_attempts attempt
  WHERE attempt.attempt_kind = p_attempt_kind
    AND attempt.subject_hash = p_subject_hash
    AND attempt.attempted_at >= now() - p_window;

  IF attempt_count >= p_limit THEN
    RETURN false;
  END IF;

  INSERT INTO public.cli_authorization_attempts(attempt_kind, subject_hash)
  VALUES (p_attempt_kind, p_subject_hash);
  RETURN true;
END;
$$;

CREATE FUNCTION public.inspect_cli_device_authorization_v1(
  p_browser_token_hash TEXT,
  p_subject_hash TEXT,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  device_request public.cli_device_authorizations%ROWTYPE;
BEGIN
  PERFORM cli_private.require_service_role();
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users actor WHERE actor.id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'invalid_cli_authorization_actor' USING ERRCODE = '22023';
  END IF;
  IF NOT cli_private.record_attempt(
    'verification', p_subject_hash, 10, INTERVAL '5 minutes'
  ) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  SELECT *
  INTO device_request
  FROM public.cli_device_authorizations candidate
  WHERE candidate.browser_token_hash = p_browser_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF device_request.expires_at <= now()
    AND device_request.status IN ('pending', 'approved')
  THEN
    UPDATE public.cli_device_authorizations
    SET status = 'expired', updated_at = now()
    WHERE id = device_request.id;
    device_request.status := 'expired';
  END IF;

  IF device_request.status IN ('approved', 'exchanging', 'consumed')
    AND device_request.approved_user_id IS DISTINCT FROM p_actor_user_id
  THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'authorizationId', device_request.id,
    'status', device_request.status,
    'clientName', device_request.client_name,
    'clientVersion', device_request.client_version,
    'clientPlatform', device_request.client_platform,
    'requestedScopes', to_jsonb(device_request.requested_scopes),
    'expiresAt', device_request.expires_at,
    'selectedCompanyId', device_request.selected_company_id
  );
END;
$$;

CREATE FUNCTION public.decide_cli_device_authorization_v1(
  p_browser_token_hash TEXT,
  p_subject_hash TEXT,
  p_decision TEXT,
  p_company_id UUID,
  p_actor_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  device_request public.cli_device_authorizations%ROWTYPE;
  company_name TEXT;
BEGIN
  PERFORM cli_private.require_service_role();
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users actor WHERE actor.id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'invalid_cli_authorization_actor' USING ERRCODE = '22023';
  END IF;
  IF NOT cli_private.record_attempt(
    'decision', p_subject_hash, 10, INTERVAL '5 minutes'
  ) THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;

  IF p_decision NOT IN ('approve', 'deny') THEN
    RETURN jsonb_build_object('error', 'invalid_decision');
  END IF;

  SELECT *
  INTO device_request
  FROM public.cli_device_authorizations candidate
  WHERE candidate.browser_token_hash = p_browser_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;
  IF device_request.expires_at <= now() THEN
    UPDATE public.cli_device_authorizations
    SET status = 'expired', updated_at = now()
    WHERE id = device_request.id AND status IN ('pending', 'approved');
    RETURN jsonb_build_object('error', 'expired');
  END IF;
  IF device_request.status <> 'pending' THEN
    RETURN jsonb_build_object('error', 'already_decided');
  END IF;

  IF p_decision = 'deny' THEN
    UPDATE public.cli_device_authorizations
    SET
      status = 'denied',
      approved_user_id = p_actor_user_id,
      denied_at = now(),
      updated_at = now()
    WHERE id = device_request.id;
    RETURN jsonb_build_object('status', 'denied');
  END IF;

  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'company_required');
  END IF;

  SELECT company.name
  INTO company_name
  FROM public.company_memberships membership
  JOIN public.companies company ON company.id = membership.company_id
  WHERE membership.company_id = p_company_id
    AND membership.user_id = p_actor_user_id
    AND membership.status = 'active';

  IF company_name IS NULL THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  UPDATE public.cli_device_authorizations
  SET
    status = 'approved',
    approved_user_id = p_actor_user_id,
    selected_company_id = p_company_id,
    approved_at = now(),
    updated_at = now()
  WHERE id = device_request.id;

  RETURN jsonb_build_object(
    'status', 'approved',
    'company', jsonb_build_object('id', p_company_id, 'name', company_name)
  );
END;
$$;

REVOKE ALL ON FUNCTION cli_private.record_attempt(TEXT, TEXT, INTEGER, INTERVAL)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inspect_cli_device_authorization_v1(TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_cli_device_authorization_v1(TEXT, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION cli_private.record_attempt(TEXT, TEXT, INTEGER, INTERVAL)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.inspect_cli_device_authorization_v1(TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_cli_device_authorization_v1(TEXT, TEXT, TEXT, UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
