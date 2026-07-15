-- Cycle 0.0.6: immutable, company-scoped model usage and reproducible costing.
-- The ledger deliberately stores only bounded attribution and numeric usage. It
-- has no columns capable of retaining prompts, model output, provider payloads,
-- credentials, email addresses, or raw provider errors.

CREATE SCHEMA IF NOT EXISTS usage_private;
REVOKE ALL ON SCHEMA usage_private FROM PUBLIC, anon, authenticated;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

CREATE TABLE public.provider_usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  workflow_run_id UUID,
  source_operation TEXT NOT NULL
    CHECK (source_operation ~ '^[a-z][a-z0-9_.:-]{0,99}$'),
  provider TEXT NOT NULL
    CHECK (provider ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  model TEXT NOT NULL
    CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  trace_id TEXT
    CHECK (trace_id IS NULL OR trace_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  run_id TEXT
    CHECK (run_id IS NULL OR run_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  measured_at TIMESTAMPTZ NOT NULL,
  completeness TEXT NOT NULL
    CHECK (completeness IN ('complete', 'partial', 'unavailable')),
  input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  cached_input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  reasoning_output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (reasoning_output_tokens >= 0),
  request_count BIGINT NOT NULL DEFAULT 1 CHECK (request_count > 0),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  payload_digest TEXT NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  recorded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key),
  UNIQUE (id, company_id),
  FOREIGN KEY (workflow_run_id, company_id)
    REFERENCES public.workflow_runs(id, company_id) ON DELETE RESTRICT,
  CHECK (
    total_tokens = 0
    OR total_tokens >= input_tokens + output_tokens
  ),
  CHECK (
    completeness <> 'unavailable'
    OR (
      input_tokens = 0
      AND output_tokens = 0
      AND total_tokens = 0
      AND cached_input_tokens = 0
      AND reasoning_output_tokens = 0
    )
  )
);

CREATE INDEX provider_usage_events_company_measured_idx
  ON public.provider_usage_events (company_id, measured_at DESC);
CREATE INDEX provider_usage_events_workflow_run_idx
  ON public.provider_usage_events (company_id, workflow_run_id, measured_at DESC)
  WHERE workflow_run_id IS NOT NULL;
CREATE INDEX provider_usage_events_trace_idx
  ON public.provider_usage_events (company_id, trace_id)
  WHERE trace_id IS NOT NULL;

CREATE TABLE public.provider_model_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL
    CHECK (provider ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  model TEXT NOT NULL
    CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'),
  metric_name TEXT NOT NULL
    CHECK (metric_name IN (
      'input_tokens',
      'output_tokens',
      'cached_input_tokens',
      'reasoning_output_tokens',
      'requests'
    )),
  rate_version TEXT NOT NULL
    CHECK (rate_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  quantity_per_unit NUMERIC(24, 6) NOT NULL CHECK (quantity_per_unit > 0),
  price_per_unit NUMERIC(24, 12) NOT NULL CHECK (price_per_unit >= 0),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  source_reference TEXT NOT NULL
    CHECK (length(source_reference) BETWEEN 1 AND 500),
  created_by UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, model, metric_name, rate_version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX provider_model_rates_lookup_idx
  ON public.provider_model_rates (
    provider,
    model,
    metric_name,
    effective_from DESC
  );

ALTER TABLE public.provider_model_rates
  ADD CONSTRAINT provider_model_rates_no_overlap
  EXCLUDE USING gist (
    provider WITH =,
    model WITH =,
    metric_name WITH =,
    tstzrange(effective_from, effective_to, '[)') WITH &&
  );

CREATE FUNCTION usage_private.reject_immutable_usage_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'provider_usage_immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER provider_usage_events_immutable
BEFORE UPDATE OR DELETE ON public.provider_usage_events
FOR EACH ROW EXECUTE FUNCTION usage_private.reject_immutable_usage_change();

CREATE FUNCTION usage_private.reject_immutable_rate_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.effective_to IS NULL
    AND NEW.effective_to IS NOT NULL
    AND NEW.effective_to > OLD.effective_from
    AND ROW(
      NEW.id, NEW.provider, NEW.model, NEW.metric_name, NEW.rate_version,
      NEW.currency, NEW.quantity_per_unit, NEW.price_per_unit,
      NEW.effective_from, NEW.source_reference, NEW.created_by, NEW.created_at
    ) IS NOT DISTINCT FROM ROW(
      OLD.id, OLD.provider, OLD.model, OLD.metric_name, OLD.rate_version,
      OLD.currency, OLD.quantity_per_unit, OLD.price_per_unit,
      OLD.effective_from, OLD.source_reference, OLD.created_by, OLD.created_at
    )
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'provider_rate_immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER provider_model_rates_immutable
BEFORE UPDATE OR DELETE ON public.provider_model_rates
FOR EACH ROW EXECUTE FUNCTION usage_private.reject_immutable_rate_change();

-- Friendly fail-fast validation complements the exclusion constraint; the
-- constraint remains the concurrency-safe authority.
CREATE FUNCTION usage_private.prevent_overlapping_provider_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.provider_model_rates rate
    WHERE rate.provider = NEW.provider
      AND rate.model = NEW.model
      AND rate.metric_name = NEW.metric_name
      AND tstzrange(rate.effective_from, rate.effective_to, '[)')
        && tstzrange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'provider_rate_window_overlap' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER provider_model_rates_overlap_preflight
BEFORE INSERT ON public.provider_model_rates
FOR EACH ROW EXECUTE FUNCTION usage_private.prevent_overlapping_provider_rate();

CREATE FUNCTION public.publish_provider_model_rate_v1(
  p_provider TEXT,
  p_model TEXT,
  p_metric_name TEXT,
  p_rate_version TEXT,
  p_currency TEXT,
  p_quantity_per_unit NUMERIC,
  p_price_per_unit NUMERIC,
  p_effective_from TIMESTAMPTZ,
  p_source_reference TEXT,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_rate public.provider_model_rates%ROWTYPE;
  inserted_id UUID;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_provider || E'\n' || p_model || E'\n' || p_metric_name, 0)
  );

  SELECT * INTO current_rate
  FROM public.provider_model_rates
  WHERE provider = p_provider
    AND model = p_model
    AND metric_name = p_metric_name
    AND effective_to IS NULL
  FOR UPDATE;

  IF FOUND THEN
    IF p_effective_from <= current_rate.effective_from THEN
      RAISE EXCEPTION 'provider_rate_effective_time_invalid' USING ERRCODE = '22023';
    END IF;
    UPDATE public.provider_model_rates
    SET effective_to = p_effective_from
    WHERE id = current_rate.id;
  END IF;

  INSERT INTO public.provider_model_rates (
    provider, model, metric_name, rate_version, currency,
    quantity_per_unit, price_per_unit, effective_from,
    source_reference, created_by
  ) VALUES (
    p_provider, p_model, p_metric_name, p_rate_version, p_currency,
    p_quantity_per_unit, p_price_per_unit, p_effective_from,
    p_source_reference, p_created_by
  ) RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

CREATE FUNCTION usage_private.safe_usage_metric(
  metrics JSONB,
  metric_name TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  raw_value JSONB;
  numeric_value NUMERIC;
BEGIN
  raw_value := metrics -> metric_name;
  IF raw_value IS NULL THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(raw_value) <> 'number' THEN
    RAISE EXCEPTION 'invalid_usage_metrics' USING ERRCODE = '22023';
  END IF;
  numeric_value := (raw_value #>> '{}')::NUMERIC;
  IF numeric_value < 0 OR numeric_value <> trunc(numeric_value)
    OR numeric_value > 9223372036854775807
  THEN
    RAISE EXCEPTION 'invalid_usage_metrics' USING ERRCODE = '22023';
  END IF;
  RETURN numeric_value::BIGINT;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid_usage_metrics' USING ERRCODE = '22023';
END;
$$;

CREATE FUNCTION public.record_provider_usage_v1(
  p_company_id UUID,
  p_recorded_by UUID,
  p_source_operation TEXT,
  p_provider TEXT,
  p_model TEXT,
  p_measured_at TIMESTAMPTZ,
  p_completeness TEXT,
  p_metrics JSONB,
  p_idempotency_key TEXT,
  p_workflow_run_id UUID DEFAULT NULL,
  p_trace_id TEXT DEFAULT NULL,
  p_run_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing public.provider_usage_events%ROWTYPE;
  inserted public.provider_usage_events%ROWTYPE;
  computed_digest TEXT;
  allowed_metric_keys CONSTANT TEXT[] := ARRAY[
    'input_tokens',
    'output_tokens',
    'total_tokens',
    'cached_input_tokens',
    'reasoning_output_tokens',
    'requests'
  ];
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.company_memberships membership
    WHERE membership.company_id = p_company_id
      AND membership.user_id = p_recorded_by
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_metrics IS NULL OR jsonb_typeof(p_metrics) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_metrics) key
      WHERE NOT (key = ANY(allowed_metric_keys))
    )
  THEN
    RAISE EXCEPTION 'invalid_usage_metrics' USING ERRCODE = '22023';
  END IF;
  IF p_measured_at > now() + interval '5 minutes'
    OR p_measured_at < now() - interval '90 days'
  THEN
    RAISE EXCEPTION 'invalid_usage_measurement_time' USING ERRCODE = '22023';
  END IF;

  computed_digest := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'company_id', p_company_id,
          'workflow_run_id', p_workflow_run_id,
          'source_operation', p_source_operation,
          'provider', p_provider,
          'model', p_model,
          'measured_at', p_measured_at,
          'completeness', p_completeness,
          'metrics', p_metrics,
          'trace_id', p_trace_id,
          'run_id', p_run_id
        )::TEXT,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.provider_usage_events (
    company_id,
    workflow_run_id,
    source_operation,
    provider,
    model,
    trace_id,
    run_id,
    measured_at,
    completeness,
    input_tokens,
    output_tokens,
    total_tokens,
    cached_input_tokens,
    reasoning_output_tokens,
    request_count,
    idempotency_key,
    payload_digest,
    recorded_by
  ) VALUES (
    p_company_id,
    p_workflow_run_id,
    p_source_operation,
    p_provider,
    p_model,
    p_trace_id,
    p_run_id,
    p_measured_at,
    p_completeness,
    usage_private.safe_usage_metric(p_metrics, 'input_tokens'),
    usage_private.safe_usage_metric(p_metrics, 'output_tokens'),
    usage_private.safe_usage_metric(p_metrics, 'total_tokens'),
    usage_private.safe_usage_metric(p_metrics, 'cached_input_tokens'),
    usage_private.safe_usage_metric(p_metrics, 'reasoning_output_tokens'),
    GREATEST(usage_private.safe_usage_metric(p_metrics, 'requests'), 1),
    p_idempotency_key,
    computed_digest,
    p_recorded_by
  )
  ON CONFLICT (company_id, idempotency_key) DO NOTHING
  RETURNING * INTO inserted;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'id', inserted.id,
      'duplicate', false,
      'completeness', inserted.completeness
    );
  END IF;

  SELECT event.* INTO existing
  FROM public.provider_usage_events event
  WHERE event.company_id = p_company_id
    AND event.idempotency_key = p_idempotency_key;

  IF existing.payload_digest <> computed_digest THEN
    RAISE EXCEPTION 'usage_idempotency_conflict' USING ERRCODE = '23505';
  END IF;

  RETURN jsonb_build_object(
    'id', existing.id,
    'duplicate', true,
    'completeness', existing.completeness
  );
END;
$$;

CREATE FUNCTION public.get_company_usage_summary_v1(
  p_company_id UUID,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result JSONB;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_company_role(p_company_id, 'viewer') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL
    OR p_period_end <= p_period_start
    OR p_period_end - p_period_start > interval '366 days'
  THEN
    RAISE EXCEPTION 'invalid_usage_period' USING ERRCODE = '22023';
  END IF;

  WITH period_events AS (
    SELECT event.*
    FROM public.provider_usage_events event
    WHERE event.company_id = p_company_id
      AND event.measured_at >= p_period_start
      AND event.measured_at < p_period_end
  ),
  metric_rows AS (
    SELECT event.id AS event_id,
      event.measured_at,
      event.provider,
      event.model,
      metric.metric_name,
      metric.quantity
    FROM period_events event
    CROSS JOIN LATERAL (
      VALUES
        ('input_tokens'::TEXT, event.input_tokens),
        ('output_tokens'::TEXT, event.output_tokens),
        ('cached_input_tokens'::TEXT, event.cached_input_tokens),
        ('reasoning_output_tokens'::TEXT, event.reasoning_output_tokens),
        ('requests'::TEXT, event.request_count)
    ) metric(metric_name, quantity)
    WHERE metric.quantity > 0
  ),
  priced_metrics AS (
    SELECT metric.*,
      rate.id AS rate_id,
      rate.rate_version,
      rate.currency,
      CASE WHEN rate.id IS NULL THEN NULL ELSE
        (metric.quantity::NUMERIC / rate.quantity_per_unit) * rate.price_per_unit
      END AS cost
    FROM metric_rows metric
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM public.provider_model_rates candidate
      WHERE candidate.provider = metric.provider
        AND candidate.model = metric.model
        AND candidate.metric_name = metric.metric_name
        AND candidate.effective_from <= metric.measured_at
        AND (
          candidate.effective_to IS NULL
          OR metric.measured_at < candidate.effective_to
        )
      ORDER BY candidate.effective_from DESC
      LIMIT 1
    ) rate ON true
  ),
  event_totals AS (
    SELECT
      count(*)::BIGINT AS event_count,
      count(*) FILTER (WHERE completeness = 'complete')::BIGINT
        AS complete_event_count,
      count(*) FILTER (WHERE completeness = 'partial')::BIGINT
        AS partial_event_count,
      count(*) FILTER (WHERE completeness = 'unavailable')::BIGINT
        AS unavailable_event_count,
      COALESCE(sum(input_tokens), 0)::BIGINT AS input_tokens,
      COALESCE(sum(output_tokens), 0)::BIGINT AS output_tokens,
      COALESCE(sum(total_tokens), 0)::BIGINT AS total_tokens,
      COALESCE(sum(cached_input_tokens), 0)::BIGINT AS cached_input_tokens,
      COALESCE(sum(reasoning_output_tokens), 0)::BIGINT
        AS reasoning_output_tokens,
      COALESCE(sum(request_count), 0)::BIGINT AS requests
    FROM period_events
  ),
  pricing_totals AS (
    SELECT
      (
        SELECT count(*)::BIGINT
        FROM priced_metrics
        WHERE rate_id IS NULL
      ) AS unpriced_metric_count,
      COALESCE(
        jsonb_agg(currency_total ORDER BY currency)
          FILTER (WHERE currency IS NOT NULL),
        '[]'::JSONB
      ) AS costs
    FROM (
      SELECT currency,
        jsonb_build_object(
          'currency', currency,
          'amount', round(sum(cost), 12),
          'rateVersionIds', jsonb_agg(DISTINCT rate_id ORDER BY rate_id)
        ) AS currency_total
      FROM priced_metrics
      WHERE rate_id IS NOT NULL
      GROUP BY currency
    ) totals
  )
  SELECT jsonb_build_object(
    'companyId', p_company_id,
    'periodStart', p_period_start,
    'periodEnd', p_period_end,
    'completeness', CASE
      WHEN event_totals.event_count = 0 THEN 'unavailable'
      WHEN event_totals.unavailable_event_count = event_totals.event_count
        THEN 'unavailable'
      WHEN event_totals.partial_event_count > 0
        OR event_totals.unavailable_event_count > 0 THEN 'partial'
      WHEN pricing_totals.unpriced_metric_count > 0 THEN 'delayed'
      ELSE 'current'
    END,
    'eventCount', event_totals.event_count,
    'completeEventCount', event_totals.complete_event_count,
    'partialEventCount', event_totals.partial_event_count,
    'unavailableEventCount', event_totals.unavailable_event_count,
    'unpricedMetricCount', pricing_totals.unpriced_metric_count,
    'metrics', jsonb_build_object(
      'inputTokens', event_totals.input_tokens,
      'outputTokens', event_totals.output_tokens,
      'totalTokens', event_totals.total_tokens,
      'cachedInputTokens', event_totals.cached_input_tokens,
      'reasoningOutputTokens', event_totals.reasoning_output_tokens,
      'requests', event_totals.requests
    ),
    'costs', pricing_totals.costs
  ) INTO result
  FROM event_totals CROSS JOIN pricing_totals;

  RETURN result;
END;
$$;

ALTER TABLE public.provider_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_model_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_usage_events_company_select
  ON public.provider_usage_events
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

REVOKE ALL ON TABLE
  public.provider_usage_events,
  public.provider_model_rates
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.provider_usage_events TO service_role;
GRANT SELECT, INSERT ON TABLE public.provider_model_rates TO service_role;

REVOKE ALL ON FUNCTION usage_private.reject_immutable_usage_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION usage_private.reject_immutable_rate_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION usage_private.prevent_overlapping_provider_rate()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION usage_private.safe_usage_metric(JSONB, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_provider_usage_v1(
  UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB, TEXT,
  UUID, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_company_usage_summary_v1(
  UUID, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_provider_model_rate_v1(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, TEXT, UUID
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.record_provider_usage_v1(
  UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB, TEXT,
  UUID, TEXT, TEXT
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_company_usage_summary_v1(
  UUID, TIMESTAMPTZ, TIMESTAMPTZ
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_provider_model_rate_v1(
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TIMESTAMPTZ, TEXT, UUID
) TO service_role;
