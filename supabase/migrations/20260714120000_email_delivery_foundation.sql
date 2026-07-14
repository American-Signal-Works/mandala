-- Durable transactional email delivery foundation.
--
-- This migration deliberately does not implement workspace invitations. A
-- future invitation service can enqueue a delivery with an opaque
-- payload_reference after it has established its own token lifecycle.

CREATE SCHEMA email_private;
REVOKE ALL ON SCHEMA email_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  template_key TEXT NOT NULL,
  template_version TEXT NOT NULL,
  payload_reference TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN (
      'queued', 'sending', 'sent', 'delivered', 'delayed', 'failed',
      'bounced', 'suppressed', 'complained'
    )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 4),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claim_token UUID,
  claim_expires_at TIMESTAMPTZ,
  provider_email_id TEXT,
  provider_event_at TIMESTAMPTZ,
  terminal_at TIMESTAMPTZ,
  last_error_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key),
  UNIQUE (id, company_id),
  UNIQUE (provider_email_id),
  CHECK (length(trim(idempotency_key)) BETWEEN 8 AND 200),
  CHECK (length(trim(template_key)) BETWEEN 1 AND 100),
  CHECK (length(trim(template_version)) BETWEEN 1 AND 40),
  CHECK (length(trim(payload_reference)) BETWEEN 1 AND 500),
  CHECK (recipient_email = lower(trim(recipient_email))),
  CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  CHECK ((claim_token IS NULL) = (claim_expires_at IS NULL))
);

COMMENT ON COLUMN public.email_deliveries.payload_reference IS
  'Opaque server-side reference only. Never store a raw invitation token, rendered action URL, or provider payload here.';

CREATE TABLE public.email_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  delivery_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 4),
  claim_token UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'sending'
    CHECK (state IN ('sending', 'sent', 'transient_failure', 'permanent_failure')),
  provider_email_id TEXT,
  error_category TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (delivery_id, attempt_number),
  UNIQUE (claim_token),
  FOREIGN KEY (delivery_id, company_id)
    REFERENCES public.email_deliveries(id, company_id) ON DELETE CASCADE
);

CREATE TABLE public.email_delivery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  delivery_id UUID NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_email_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'sent', 'delivered', 'delayed', 'failed', 'bounced',
      'suppressed', 'complained'
    )),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied BOOLEAN NOT NULL DEFAULT false,
  safe_reason TEXT,
  FOREIGN KEY (delivery_id, company_id)
    REFERENCES public.email_deliveries(id, company_id) ON DELETE CASCADE
);

CREATE TABLE public.email_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  recipient_hash TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('bounced', 'suppressed', 'complained')),
  source_delivery_id UUID,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, recipient_hash),
  FOREIGN KEY (source_delivery_id, company_id)
    REFERENCES public.email_deliveries(id, company_id)
    ON DELETE SET NULL (source_delivery_id),
  CHECK (recipient_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX email_deliveries_due_idx
  ON public.email_deliveries (next_attempt_at, created_at)
  WHERE state = 'queued';
CREATE INDEX email_deliveries_company_state_idx
  ON public.email_deliveries (company_id, state, created_at DESC);
CREATE INDEX email_delivery_attempts_delivery_idx
  ON public.email_delivery_attempts (delivery_id, attempt_number DESC);
CREATE INDEX email_delivery_events_delivery_idx
  ON public.email_delivery_events (delivery_id, occurred_at DESC);
CREATE INDEX email_suppressions_active_idx
  ON public.email_suppressions (company_id, recipient_hash)
  WHERE active;

CREATE TRIGGER email_deliveries_touch BEFORE UPDATE ON public.email_deliveries
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER email_suppressions_touch BEFORE UPDATE ON public.email_suppressions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

-- Only an active workspace Owner may inspect safe delivery state. All writes
-- are performed by service-role RPCs below.
CREATE POLICY email_deliveries_owner_select ON public.email_deliveries
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'owner'));

CREATE POLICY email_delivery_attempts_owner_select ON public.email_delivery_attempts
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'owner'));

CREATE POLICY email_delivery_events_owner_select ON public.email_delivery_events
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'owner'));

REVOKE ALL ON public.email_deliveries, public.email_delivery_attempts,
  public.email_delivery_events, public.email_suppressions
FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id, company_id, template_key, template_version, state, attempt_count,
  next_attempt_at, terminal_at, created_at, updated_at
) ON public.email_deliveries TO authenticated;
GRANT SELECT (
  id, company_id, delivery_id, attempt_number, state, started_at, finished_at
) ON public.email_delivery_attempts TO authenticated;
GRANT SELECT (
  id, company_id, delivery_id, event_type, occurred_at, received_at, applied
) ON public.email_delivery_events TO authenticated;
GRANT ALL ON public.email_deliveries, public.email_delivery_attempts,
  public.email_delivery_events, public.email_suppressions TO service_role;

CREATE VIEW public.email_delivery_owner_status
WITH (security_invoker = true)
AS
SELECT
  id,
  company_id,
  template_key,
  template_version,
  state,
  attempt_count,
  CASE
    WHEN state IN ('failed', 'bounced', 'suppressed', 'complained')
      THEN 'Not delivered'
    ELSE NULL
  END AS owner_status,
  created_at,
  updated_at
FROM public.email_deliveries;

REVOKE ALL ON public.email_delivery_owner_status FROM PUBLIC, anon;
GRANT SELECT ON public.email_delivery_owner_status TO authenticated, service_role;

CREATE FUNCTION email_private.recipient_hash(p_recipient_email TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT encode(
    extensions.digest(convert_to(lower(trim(p_recipient_email)), 'UTF8'), 'sha256'),
    'hex'
  )
$$;

REVOKE ALL ON FUNCTION email_private.recipient_hash(TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_private.recipient_hash(TEXT) TO service_role;

CREATE FUNCTION public.enqueue_email_delivery(
  p_company_id UUID,
  p_idempotency_key TEXT,
  p_template_key TEXT,
  p_template_version TEXT,
  p_payload_reference TEXT,
  p_recipient_email TEXT,
  p_due_at TIMESTAMPTZ DEFAULT now()
)
RETURNS public.email_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  normalized_email TEXT := lower(trim(p_recipient_email));
  normalized_hash TEXT;
  result public.email_deliveries%ROWTYPE;
  is_suppressed BOOLEAN;
BEGIN
  IF normalized_email = '' OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid recipient' USING ERRCODE = '22023';
  END IF;

  normalized_hash := email_private.recipient_hash(normalized_email);
  SELECT EXISTS (
    SELECT 1
    FROM public.email_suppressions suppression
    WHERE suppression.company_id = p_company_id
      AND suppression.recipient_hash = normalized_hash
      AND suppression.active
  ) INTO is_suppressed;

  INSERT INTO public.email_deliveries (
    company_id, idempotency_key, template_key, template_version,
    payload_reference, recipient_email, recipient_hash, state,
    next_attempt_at, terminal_at
  ) VALUES (
    p_company_id, trim(p_idempotency_key), trim(p_template_key),
    trim(p_template_version), trim(p_payload_reference), normalized_email,
    normalized_hash,
    CASE WHEN is_suppressed THEN 'suppressed' ELSE 'queued' END,
    COALESCE(p_due_at, now()),
    CASE WHEN is_suppressed THEN now() ELSE NULL END
  )
  ON CONFLICT (company_id, idempotency_key) DO UPDATE
    SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING * INTO result;

  RETURN result;
END;
$$;

CREATE FUNCTION public.claim_due_email_deliveries(
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
  IF p_limit < 1 OR p_limit > 100 OR p_lease_seconds < 30 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'invalid claim limits' USING ERRCODE = '22023';
  END IF;

  -- Recover abandoned leases before taking new work. Reusing the logical
  -- delivery's stable provider key makes this safe even if a worker reached
  -- the provider but crashed before recording its result.
  UPDATE public.email_delivery_attempts attempt
  SET state = 'transient_failure', finished_at = now(),
      error_category = 'claim_lease_expired'
  FROM public.email_deliveries delivery
  WHERE attempt.delivery_id = delivery.id
    AND attempt.claim_token = delivery.claim_token
    AND attempt.state = 'sending'
    AND delivery.state = 'sending'
    AND delivery.claim_expires_at <= now();

  UPDATE public.email_deliveries delivery
  SET state = CASE WHEN delivery.attempt_count < 4 THEN 'queued' ELSE 'failed' END,
      next_attempt_at = now(),
      terminal_at = CASE WHEN delivery.attempt_count < 4 THEN NULL ELSE now() END,
      last_error_category = 'claim_lease_expired',
      claim_token = NULL,
      claim_expires_at = NULL
  WHERE delivery.state = 'sending'
    AND delivery.claim_expires_at <= now();

  -- A suppression may arrive after a retry was scheduled. Close those rows
  -- before claiming so they can never be sent automatically again.
  UPDATE public.email_deliveries delivery
  SET state = 'suppressed', terminal_at = now(), claim_token = NULL,
      claim_expires_at = NULL, last_error_category = 'recipient_suppressed'
  WHERE delivery.state IN ('queued', 'delayed')
    AND EXISTS (
      SELECT 1 FROM public.email_suppressions suppression
      WHERE suppression.company_id = delivery.company_id
        AND suppression.recipient_hash = delivery.recipient_hash
        AND suppression.active
    );

  FOR candidate IN
    SELECT delivery.*
    FROM public.email_deliveries delivery
    WHERE delivery.state = 'queued'
      AND delivery.next_attempt_at <= now()
      AND delivery.attempt_count < 4
      AND (delivery.claim_expires_at IS NULL OR delivery.claim_expires_at <= now())
    ORDER BY delivery.next_attempt_at, delivery.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  LOOP
    new_claim_token := gen_random_uuid();

    UPDATE public.email_deliveries delivery
    SET state = 'sending',
        attempt_count = delivery.attempt_count + 1,
        claim_token = new_claim_token,
        claim_expires_at = now() + make_interval(secs => p_lease_seconds)
    WHERE delivery.id = candidate.id;

    INSERT INTO public.email_delivery_attempts (
      company_id, delivery_id, attempt_number, claim_token
    ) VALUES (
      candidate.company_id, candidate.id, candidate.attempt_count + 1,
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

CREATE FUNCTION public.record_email_delivery_result(
  p_delivery_id UUID,
  p_claim_token UUID,
  p_outcome TEXT,
  p_provider_email_id TEXT DEFAULT NULL,
  p_error_category TEXT DEFAULT NULL,
  p_finished_at TIMESTAMPTZ DEFAULT now()
)
RETURNS public.email_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  delivery public.email_deliveries%ROWTYPE;
  result public.email_deliveries%ROWTYPE;
  retry_at TIMESTAMPTZ;
BEGIN
  IF p_outcome NOT IN ('sent', 'transient_failure', 'permanent_failure') THEN
    RAISE EXCEPTION 'invalid delivery outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO delivery
  FROM public.email_deliveries candidate
  WHERE candidate.id = p_delivery_id
  FOR UPDATE;

  IF delivery.id IS NULL OR delivery.claim_token IS DISTINCT FROM p_claim_token
    OR delivery.state <> 'sending' THEN
    RAISE EXCEPTION 'stale delivery claim' USING ERRCODE = '40001';
  END IF;

  IF p_outcome = 'sent' AND COALESCE(trim(p_provider_email_id), '') = '' THEN
    RAISE EXCEPTION 'provider email id required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.email_delivery_attempts attempt
  SET state = p_outcome,
      provider_email_id = NULLIF(trim(p_provider_email_id), ''),
      error_category = NULLIF(trim(p_error_category), ''),
      finished_at = COALESCE(p_finished_at, now())
  WHERE attempt.delivery_id = p_delivery_id
    AND attempt.claim_token = p_claim_token;

  IF p_outcome = 'sent' THEN
    UPDATE public.email_deliveries candidate
    SET state = 'sent', provider_email_id = trim(p_provider_email_id),
        provider_event_at = COALESCE(p_finished_at, now()), terminal_at = NULL,
        last_error_category = NULL, claim_token = NULL, claim_expires_at = NULL
    WHERE candidate.id = p_delivery_id
    RETURNING * INTO result;
  ELSIF p_outcome = 'transient_failure' AND delivery.attempt_count < 4 THEN
    retry_at := COALESCE(p_finished_at, now()) + CASE delivery.attempt_count
      WHEN 1 THEN interval '1 minute'
      WHEN 2 THEN interval '5 minutes'
      ELSE interval '15 minutes'
    END;

    UPDATE public.email_deliveries candidate
    SET state = 'queued', next_attempt_at = retry_at,
        last_error_category = COALESCE(NULLIF(trim(p_error_category), ''), 'transient_provider_failure'),
        claim_token = NULL, claim_expires_at = NULL
    WHERE candidate.id = p_delivery_id
    RETURNING * INTO result;
  ELSE
    UPDATE public.email_deliveries candidate
    SET state = 'failed', terminal_at = COALESCE(p_finished_at, now()),
        last_error_category = COALESCE(NULLIF(trim(p_error_category), ''), 'permanent_provider_failure'),
        claim_token = NULL, claim_expires_at = NULL
    WHERE candidate.id = p_delivery_id
    RETURNING * INTO result;
  END IF;

  RETURN result;
END;
$$;

CREATE FUNCTION email_private.event_rank(p_event_type TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT CASE p_event_type
    WHEN 'sent' THEN 10
    WHEN 'delayed' THEN 20
    WHEN 'delivered' THEN 30
    WHEN 'failed' THEN 40
    WHEN 'bounced' THEN 50
    WHEN 'suppressed' THEN 60
    WHEN 'complained' THEN 70
    ELSE 0
  END
$$;

CREATE FUNCTION public.purge_terminal_email_delivery_pii(
  p_before TIMESTAMPTZ DEFAULT now() - interval '90 days'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  purged_count INTEGER;
BEGIN
  IF p_before > now() - interval '90 days' THEN
    RAISE EXCEPTION 'retention boundary must be at least 90 days old'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.email_deliveries delivery
  SET recipient_email = 'purged-' || delivery.id::TEXT || '@invalid.test',
      recipient_hash = email_private.recipient_hash(delivery.id::TEXT),
      payload_reference = 'purged:' || delivery.id::TEXT
  WHERE delivery.terminal_at IS NOT NULL
    AND delivery.terminal_at < p_before
    AND delivery.recipient_email NOT LIKE 'purged-%@invalid.test';

  GET DIAGNOSTICS purged_count = ROW_COUNT;
  RETURN purged_count;
END;
$$;

CREATE FUNCTION public.record_email_delivery_webhook_event(
  p_provider_event_id TEXT,
  p_provider_email_id TEXT,
  p_event_type TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_safe_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  delivery public.email_deliveries%ROWTYPE;
  inserted_event_id UUID;
  should_apply BOOLEAN := false;
BEGIN
  IF p_event_type NOT IN (
    'sent', 'delivered', 'delayed', 'failed', 'bounced',
    'suppressed', 'complained'
  ) THEN
    RAISE EXCEPTION 'unsupported provider event' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO delivery
  FROM public.email_deliveries candidate
  WHERE candidate.provider_email_id = trim(p_provider_email_id)
  FOR UPDATE;

  IF delivery.id IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'duplicate', false, 'applied', false);
  END IF;

  INSERT INTO public.email_delivery_events (
    company_id, delivery_id, provider_event_id, provider_email_id,
    event_type, occurred_at, safe_reason
  ) VALUES (
    delivery.company_id, delivery.id, trim(p_provider_event_id),
    trim(p_provider_email_id), p_event_type, p_occurred_at,
    NULLIF(trim(p_safe_reason), '')
  )
  ON CONFLICT (provider_event_id) DO NOTHING
  RETURNING id INTO inserted_event_id;

  IF inserted_event_id IS NULL THEN
    RETURN jsonb_build_object('matched', true, 'duplicate', true, 'applied', false);
  END IF;

  should_apply := delivery.provider_event_at IS NULL
    OR p_occurred_at > delivery.provider_event_at
    OR (
      p_occurred_at = delivery.provider_event_at
      AND email_private.event_rank(p_event_type) > email_private.event_rank(delivery.state)
    );

  IF p_event_type IN ('bounced', 'suppressed', 'complained') THEN
    INSERT INTO public.email_suppressions (
      company_id, recipient_hash, reason, source_delivery_id
    ) VALUES (
      delivery.company_id, delivery.recipient_hash, p_event_type, delivery.id
    )
    ON CONFLICT (company_id, recipient_hash) DO UPDATE
      SET reason = EXCLUDED.reason, source_delivery_id = EXCLUDED.source_delivery_id,
          active = true;
  END IF;

  IF should_apply THEN
    UPDATE public.email_deliveries candidate
    SET state = p_event_type,
        provider_event_at = p_occurred_at,
        terminal_at = CASE
          WHEN p_event_type IN ('delivered', 'failed', 'bounced', 'suppressed', 'complained')
            THEN p_occurred_at
          ELSE NULL
        END,
        last_error_category = CASE
          WHEN p_event_type IN ('failed', 'bounced', 'suppressed', 'complained')
            THEN COALESCE(NULLIF(trim(p_safe_reason), ''), 'provider_' || p_event_type)
          ELSE NULL
        END,
        claim_token = NULL,
        claim_expires_at = NULL
    WHERE candidate.id = delivery.id;

    UPDATE public.email_delivery_events event
    SET applied = true
    WHERE event.id = inserted_event_id;
  END IF;

  RETURN jsonb_build_object('matched', true, 'duplicate', false, 'applied', should_apply);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_email_delivery(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_email_deliveries(INTEGER, INTEGER)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_email_delivery_result(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_email_delivery_webhook_event(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_terminal_email_delivery_pii(TIMESTAMPTZ)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION email_private.event_rank(TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_email_delivery(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ)
TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_email_deliveries(INTEGER, INTEGER)
TO service_role;
GRANT EXECUTE ON FUNCTION public.record_email_delivery_result(UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
TO service_role;
GRANT EXECUTE ON FUNCTION public.record_email_delivery_webhook_event(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT)
TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_terminal_email_delivery_pii(TIMESTAMPTZ)
TO service_role;
GRANT EXECUTE ON FUNCTION email_private.event_rank(TEXT) TO service_role;
