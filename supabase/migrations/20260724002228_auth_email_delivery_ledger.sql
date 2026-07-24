-- Route short-lived Supabase Auth emails through the durable delivery ledger
-- without persisting the one-time token, token hash, action URL, or rendered
-- email body. Authentication payloads are sent inline while the verified hook
-- request is in memory; only their safe delivery evidence is durable.

ALTER TABLE public.email_deliveries
  ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'worker'
    CHECK (delivery_mode IN ('worker', 'inline_auth'));

ALTER TABLE public.email_deliveries
  ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.email_delivery_attempts
  ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.email_delivery_events
  ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE public.email_suppressions
  ALTER COLUMN company_id DROP NOT NULL;

-- A platform-scoped auth delivery has no company yet. Replace composite child
-- foreign keys with the globally unique delivery id so those rows remain fully
-- constrained even when company_id is NULL.
ALTER TABLE public.email_delivery_attempts
  DROP CONSTRAINT email_delivery_attempts_delivery_id_company_id_fkey,
  ADD CONSTRAINT email_delivery_attempts_delivery_id_fkey
    FOREIGN KEY (delivery_id)
    REFERENCES public.email_deliveries(id) ON DELETE CASCADE;

ALTER TABLE public.email_delivery_events
  DROP CONSTRAINT email_delivery_events_delivery_id_company_id_fkey,
  ADD CONSTRAINT email_delivery_events_delivery_id_fkey
    FOREIGN KEY (delivery_id)
    REFERENCES public.email_deliveries(id) ON DELETE CASCADE;

ALTER TABLE public.email_suppressions
  DROP CONSTRAINT email_suppressions_source_delivery_id_company_id_fkey,
  ADD CONSTRAINT email_suppressions_source_delivery_id_fkey
    FOREIGN KEY (source_delivery_id)
    REFERENCES public.email_deliveries(id) ON DELETE SET NULL;

-- NULLS NOT DISTINCT gives not-yet-onboarded recipients one platform-level
-- suppression row instead of allowing duplicate NULL-scoped rows.
ALTER TABLE public.email_suppressions
  DROP CONSTRAINT email_suppressions_company_id_recipient_hash_key,
  ADD CONSTRAINT email_suppressions_company_id_recipient_hash_key
    UNIQUE NULLS NOT DISTINCT (company_id, recipient_hash);

CREATE UNIQUE INDEX email_deliveries_inline_auth_idempotency_idx
  ON public.email_deliveries (idempotency_key)
  WHERE delivery_mode = 'inline_auth';

COMMENT ON COLUMN public.email_deliveries.delivery_mode IS
  'worker rows can regenerate their payload from payload_reference; inline_auth rows must be sent while the verified Auth hook payload remains only in memory.';

CREATE FUNCTION public.enqueue_auth_email_delivery(
  p_user_id UUID,
  p_webhook_id TEXT,
  p_template_key TEXT,
  p_recipient_email TEXT
)
RETURNS public.email_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_email TEXT := lower(trim(p_recipient_email));
  canonical_email TEXT;
  normalized_hash TEXT;
  resolved_company_id UUID;
  is_suppressed BOOLEAN;
  result public.email_deliveries%ROWTYPE;
  normalized_webhook_id TEXT := trim(p_webhook_id);
BEGIN
  IF p_template_key NOT IN ('auth_magic_link', 'auth_recovery') THEN
    RAISE EXCEPTION 'unsupported auth email template' USING ERRCODE = '22023';
  END IF;

  IF length(normalized_webhook_id) NOT BETWEEN 1 AND 160
    OR normalized_webhook_id !~ '^[A-Za-z0-9_.:-]+$' THEN
    RAISE EXCEPTION 'invalid auth hook id' USING ERRCODE = '22023';
  END IF;

  IF normalized_email = ''
    OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid recipient' USING ERRCODE = '22023';
  END IF;

  SELECT lower(trim(auth_user.email))
  INTO canonical_email
  FROM auth.users auth_user
  WHERE auth_user.id = p_user_id;

  IF canonical_email IS NULL OR canonical_email <> normalized_email THEN
    RAISE EXCEPTION 'auth recipient mismatch' USING ERRCODE = '22023';
  END IF;

  -- Prefer the highest-responsibility active workspace so an existing user's
  -- Owner has a deterministic safe status row. A not-yet-accepted invite is
  -- the next-best scope; a brand-new user remains platform-scoped (NULL).
  SELECT membership.company_id
  INTO resolved_company_id
  FROM public.company_memberships membership
  WHERE membership.user_id = p_user_id
    AND membership.status = 'active'
  ORDER BY
    public.company_role_rank(membership.role) DESC,
    membership.created_at,
    membership.company_id
  LIMIT 1;

  IF resolved_company_id IS NULL THEN
    SELECT invitation.company_id
    INTO resolved_company_id
    FROM public.company_invitations invitation
    WHERE invitation.recipient_hash =
      email_private.recipient_hash(normalized_email)
      AND invitation.state = 'pending'
      AND invitation.expires_at > now()
    ORDER BY invitation.issued_at DESC, invitation.id
    LIMIT 1;
  END IF;

  normalized_hash := email_private.recipient_hash(normalized_email);

  SELECT EXISTS (
    SELECT 1
    FROM public.email_suppressions suppression
    WHERE suppression.company_id IS NOT DISTINCT FROM resolved_company_id
      AND suppression.recipient_hash = normalized_hash
      AND suppression.active
  ) INTO is_suppressed;

  INSERT INTO public.email_deliveries (
    company_id,
    idempotency_key,
    template_key,
    template_version,
    payload_reference,
    recipient_email,
    recipient_hash,
    delivery_mode,
    state,
    next_attempt_at,
    terminal_at
  ) VALUES (
    resolved_company_id,
    'auth-hook:' || normalized_webhook_id,
    p_template_key,
    '1',
    'auth_hook:' || normalized_webhook_id,
    normalized_email,
    normalized_hash,
    'inline_auth',
    CASE WHEN is_suppressed THEN 'suppressed' ELSE 'queued' END,
    now(),
    CASE WHEN is_suppressed THEN now() ELSE NULL END
  )
  ON CONFLICT (idempotency_key)
    WHERE delivery_mode = 'inline_auth'
  DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING * INTO result;

  RETURN result;
END;
$$;

CREATE FUNCTION public.claim_inline_auth_email_delivery(
  p_delivery_id UUID
)
RETURNS TABLE (
  delivery_id UUID,
  company_id UUID,
  template_key TEXT,
  template_version TEXT,
  payload_reference TEXT,
  recipient_email TEXT,
  idempotency_key TEXT,
  attempt_number INTEGER,
  claim_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate public.email_deliveries%ROWTYPE;
  new_claim_token UUID;
BEGIN
  SELECT *
  INTO candidate
  FROM public.email_deliveries delivery
  WHERE delivery.id = p_delivery_id
  FOR UPDATE;

  IF candidate.id IS NULL OR candidate.delivery_mode <> 'inline_auth' THEN
    RAISE EXCEPTION 'inline auth delivery not found' USING ERRCODE = '22023';
  END IF;

  IF candidate.state = 'sending'
    AND candidate.claim_expires_at <= now() THEN
    UPDATE public.email_delivery_attempts attempt
    SET
      state = 'transient_failure',
      finished_at = now(),
      error_category = 'claim_lease_expired'
    WHERE attempt.delivery_id = candidate.id
      AND attempt.claim_token = candidate.claim_token
      AND attempt.state = 'sending';

    UPDATE public.email_deliveries delivery
    SET
      state = CASE WHEN delivery.attempt_count < 4 THEN 'queued' ELSE 'failed' END,
      next_attempt_at = now(),
      terminal_at = CASE WHEN delivery.attempt_count < 4 THEN NULL ELSE now() END,
      last_error_category = 'claim_lease_expired',
      claim_token = NULL,
      claim_expires_at = NULL
    WHERE delivery.id = candidate.id
    RETURNING * INTO candidate;
  END IF;

  IF candidate.state <> 'queued' OR candidate.attempt_count >= 4 THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.email_suppressions suppression
    WHERE suppression.company_id IS NOT DISTINCT FROM candidate.company_id
      AND suppression.recipient_hash = candidate.recipient_hash
      AND suppression.active
  ) THEN
    UPDATE public.email_deliveries delivery
    SET
      state = 'suppressed',
      terminal_at = now(),
      last_error_category = 'recipient_suppressed',
      claim_token = NULL,
      claim_expires_at = NULL
    WHERE delivery.id = candidate.id;
    RETURN;
  END IF;

  new_claim_token := gen_random_uuid();

  UPDATE public.email_deliveries delivery
  SET
    state = 'sending',
    attempt_count = delivery.attempt_count + 1,
    claim_token = new_claim_token,
    claim_expires_at = now() + interval '30 seconds'
  WHERE delivery.id = candidate.id;

  INSERT INTO public.email_delivery_attempts (
    company_id,
    delivery_id,
    attempt_number,
    claim_token
  ) VALUES (
    candidate.company_id,
    candidate.id,
    candidate.attempt_count + 1,
    new_claim_token
  );

  delivery_id := candidate.id;
  company_id := candidate.company_id;
  template_key := candidate.template_key;
  template_version := candidate.template_version;
  payload_reference := candidate.payload_reference;
  recipient_email := candidate.recipient_email;
  idempotency_key := candidate.idempotency_key;
  attempt_number := candidate.attempt_count + 1;
  claim_token := new_claim_token;
  RETURN NEXT;
END;
$$;

-- The scheduled worker may only claim rows whose safe payload can be
-- regenerated from the opaque reference. Auth rows are handled by the signed
-- hook while their token-bearing payload remains in memory.
CREATE OR REPLACE FUNCTION public.claim_due_email_deliveries(
  p_limit INTEGER DEFAULT 25,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
  delivery_id UUID,
  company_id UUID,
  template_key TEXT,
  template_version TEXT,
  payload_reference TEXT,
  recipient_email TEXT,
  idempotency_key TEXT,
  attempt_number INTEGER,
  claim_token UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate public.email_deliveries%ROWTYPE;
  new_claim_token UUID;
BEGIN
  IF p_limit < 1 OR p_limit > 100
    OR p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'invalid claim limits' USING ERRCODE = '22023';
  END IF;

  UPDATE public.email_delivery_attempts attempt
  SET
    state = 'transient_failure',
    finished_at = now(),
    error_category = 'claim_lease_expired'
  FROM public.email_deliveries delivery
  WHERE attempt.delivery_id = delivery.id
    AND attempt.claim_token = delivery.claim_token
    AND attempt.state = 'sending'
    AND delivery.delivery_mode = 'worker'
    AND delivery.state = 'sending'
    AND delivery.claim_expires_at <= now();

  UPDATE public.email_deliveries delivery
  SET
    state = CASE WHEN delivery.attempt_count < 4 THEN 'queued' ELSE 'failed' END,
    next_attempt_at = now(),
    terminal_at = CASE WHEN delivery.attempt_count < 4 THEN NULL ELSE now() END,
    last_error_category = 'claim_lease_expired',
    claim_token = NULL,
    claim_expires_at = NULL
  WHERE delivery.delivery_mode = 'worker'
    AND delivery.state = 'sending'
    AND delivery.claim_expires_at <= now();

  UPDATE public.email_deliveries delivery
  SET
    state = 'suppressed',
    terminal_at = now(),
    claim_token = NULL,
    claim_expires_at = NULL,
    last_error_category = 'recipient_suppressed'
  WHERE delivery.delivery_mode = 'worker'
    AND delivery.state IN ('queued', 'delayed')
    AND EXISTS (
      SELECT 1
      FROM public.email_suppressions suppression
      WHERE suppression.company_id IS NOT DISTINCT FROM delivery.company_id
        AND suppression.recipient_hash = delivery.recipient_hash
        AND suppression.active
    );

  FOR candidate IN
    SELECT delivery.*
    FROM public.email_deliveries delivery
    WHERE delivery.delivery_mode = 'worker'
      AND delivery.state = 'queued'
      AND delivery.next_attempt_at <= now()
      AND delivery.attempt_count < 4
      AND (
        delivery.claim_expires_at IS NULL
        OR delivery.claim_expires_at <= now()
      )
    ORDER BY delivery.next_attempt_at, delivery.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  LOOP
    new_claim_token := gen_random_uuid();

    UPDATE public.email_deliveries delivery
    SET
      state = 'sending',
      attempt_count = delivery.attempt_count + 1,
      claim_token = new_claim_token,
      claim_expires_at = now() + make_interval(secs => p_lease_seconds)
    WHERE delivery.id = candidate.id;

    INSERT INTO public.email_delivery_attempts (
      company_id,
      delivery_id,
      attempt_number,
      claim_token
    ) VALUES (
      candidate.company_id,
      candidate.id,
      candidate.attempt_count + 1,
      new_claim_token
    );

    delivery_id := candidate.id;
    company_id := candidate.company_id;
    template_key := candidate.template_key;
    template_version := candidate.template_version;
    payload_reference := candidate.payload_reference;
    recipient_email := candidate.recipient_email;
    idempotency_key := candidate.idempotency_key;
    attempt_number := candidate.attempt_count + 1;
    claim_token := new_claim_token;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_auth_email_delivery(UUID, TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_inline_auth_email_delivery(UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
  ON FUNCTION public.enqueue_auth_email_delivery(UUID, TEXT, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE
  ON FUNCTION public.claim_inline_auth_email_delivery(UUID)
  TO service_role;

COMMENT ON FUNCTION public.enqueue_auth_email_delivery(UUID, TEXT, TEXT, TEXT) IS
  'Creates one inline authentication delivery from a verified hook id without accepting or storing token material.';
COMMENT ON FUNCTION public.claim_inline_auth_email_delivery(UUID) IS
  'Claims one inline authentication delivery for an immediate bounded attempt; never used by the scheduled worker.';
