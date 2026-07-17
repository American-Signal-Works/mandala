-- Align the production CLI authorization RPC with the browser-token contract
-- already used by the web application and generated database types.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cli_device_authorizations'
      AND column_name = 'user_code_hash'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cli_device_authorizations'
      AND column_name = 'browser_token_hash'
  ) THEN
    ALTER TABLE public.cli_device_authorizations
      RENAME COLUMN user_code_hash TO browser_token_hash;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_device_authorizations'::regclass
      AND conname = 'cli_device_authorizations_user_code_hash_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_device_authorizations'::regclass
      AND conname = 'cli_device_authorizations_browser_token_hash_key'
  ) THEN
    ALTER TABLE public.cli_device_authorizations
      RENAME CONSTRAINT cli_device_authorizations_user_code_hash_key
      TO cli_device_authorizations_browser_token_hash_key;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_device_authorizations'::regclass
      AND conname = 'cli_device_authorizations_user_code_hash_check'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.cli_device_authorizations'::regclass
      AND conname = 'cli_device_authorizations_browser_token_hash_check'
  ) THEN
    ALTER TABLE public.cli_device_authorizations
      RENAME CONSTRAINT cli_device_authorizations_user_code_hash_check
      TO cli_device_authorizations_browser_token_hash_check;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.create_cli_device_authorization_v1(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ
);
DROP FUNCTION IF EXISTS public.inspect_cli_device_authorization_v1(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.inspect_cli_device_authorization_v1(TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.decide_cli_device_authorization_v1(TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.decide_cli_device_authorization_v1(TEXT, TEXT, TEXT, UUID, UUID);

CREATE FUNCTION public.create_cli_device_authorization_v1(
  p_id UUID,
  p_device_code_hash TEXT,
  p_browser_token_hash TEXT,
  p_requester_hash TEXT,
  p_client_name TEXT,
  p_client_version TEXT,
  p_client_platform TEXT,
  p_requested_scopes TEXT[] DEFAULT ARRAY['workspace:control']::TEXT[],
  p_expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '10 minutes'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  recent_requests INTEGER;
BEGIN
  PERFORM cli_private.require_service_role();

  IF p_id IS NULL
    OR p_device_code_hash !~ '^[a-f0-9]{64}$'
    OR p_browser_token_hash !~ '^[a-f0-9]{64}$'
    OR p_requester_hash !~ '^[a-f0-9]{64}$'
    OR length(COALESCE(p_client_name, '')) NOT BETWEEN 1 AND 120
    OR length(COALESCE(p_client_version, '')) NOT BETWEEN 1 AND 40
    OR length(COALESCE(p_client_platform, '')) NOT BETWEEN 1 AND 80
    OR cardinality(COALESCE(p_requested_scopes, ARRAY[]::TEXT[])) NOT BETWEEN 1 AND 10
    OR p_requested_scopes <@ ARRAY['workspace:control']::TEXT[] IS NOT TRUE
    OR p_expires_at <= now() + INTERVAL '2 minutes'
    OR p_expires_at > now() + INTERVAL '15 minutes'
  THEN
    RAISE EXCEPTION 'invalid_cli_device_authorization' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_requester_hash));
  SELECT count(*)::INTEGER
  INTO recent_requests
  FROM public.cli_device_authorizations device_request
  WHERE device_request.requester_hash = p_requester_hash
    AND device_request.created_at >= now() - INTERVAL '10 minutes';

  IF recent_requests >= 5 THEN
    RAISE EXCEPTION 'cli_authorization_rate_limited' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.cli_device_authorizations(
    id,
    device_code_hash,
    browser_token_hash,
    requester_hash,
    client_name,
    client_version,
    client_platform,
    requested_scopes,
    expires_at
  ) VALUES (
    p_id,
    p_device_code_hash,
    p_browser_token_hash,
    p_requester_hash,
    p_client_name,
    p_client_version,
    p_client_platform,
    p_requested_scopes,
    p_expires_at
  );

  RETURN jsonb_build_object(
    'authorizationId', p_id,
    'expiresAt', p_expires_at,
    'intervalSeconds', 5
  );
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

REVOKE ALL ON FUNCTION public.create_cli_device_authorization_v1(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inspect_cli_device_authorization_v1(TEXT, TEXT, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_cli_device_authorization_v1(TEXT, TEXT, TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_cli_device_authorization_v1(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TIMESTAMPTZ
) TO service_role;
GRANT EXECUTE ON FUNCTION public.inspect_cli_device_authorization_v1(TEXT, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_cli_device_authorization_v1(TEXT, TEXT, TEXT, UUID, UUID)
  TO service_role;

NOTIFY pgrst, 'reload schema';
