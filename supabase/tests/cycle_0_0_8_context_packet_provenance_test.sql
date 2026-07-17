BEGIN;
SELECT plan(21);

SELECT has_column(
  'public', 'workflow_context_packets', 'operational_context',
  'workflow packets store provider provenance separately'
);
SELECT col_type_is(
  'public', 'workflow_context_packets', 'operational_context', 'jsonb',
  'provider provenance uses bounded structured JSON'
);
SELECT has_function(
  'workflow_private', 'extract_context_packet_operational_context_v1', ARRAY[]::TEXT[],
  'controlled persistence has a provenance extraction trigger function'
);
SELECT has_trigger(
  'public', 'workflow_context_packets',
  'workflow_context_packets_extract_operational_context_v1',
  'provenance extraction runs before packet storage'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'workflow_private.extract_context_packet_operational_context_v1()',
    'EXECUTE'
  ),
  false,
  'members cannot invoke the internal extraction function'
);
SELECT is(
  has_function_privilege(
    'service_role',
    'workflow_private.extract_context_packet_operational_context_v1()',
    'EXECUTE'
  ),
  false,
  'service role cannot invoke the extraction function directly'
);
SELECT has_function(
  'workflow_private', 'get_workflow_context_provenance_v1', ARRAY['uuid', 'uuid'],
  'private provenance reader exists behind the product projection'
);
SELECT has_function(
  'public', 'get_workflow_context_provenance_v1', ARRAY['uuid', 'uuid'],
  'public provenance reader exposes the controlled projection'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.get_workflow_context_provenance_v1(uuid, uuid)',
    'EXECUTE'
  ),
  true,
  'members can invoke the controlled provenance projection'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.get_workflow_context_provenance_v1(uuid, uuid)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot invoke the provenance projection'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'workflow_private.get_workflow_context_provenance_v1(uuid, uuid)',
    'EXECUTE'
  ),
  false,
  'members cannot bypass the public provenance projection'
);

CREATE TEMP TABLE context_packet_extraction_probe (
  company_id UUID NOT NULL,
  facts JSONB NOT NULL,
  operational_context JSONB
);
CREATE TRIGGER context_packet_extraction_probe_trigger
BEFORE INSERT ON context_packet_extraction_probe
FOR EACH ROW
EXECUTE FUNCTION workflow_private.extract_context_packet_operational_context_v1();

INSERT INTO context_packet_extraction_probe(company_id, facts)
VALUES (
  '20000000-0000-4000-8000-000000000001',
  '{
    "canonical":{"sku":"A-1"},
    "__mandalaOperationalContextV1":{
      "provider":"supermemory",
      "status":"unavailable",
      "requestId":"21000000-0000-4000-8000-000000000001",
      "scope":{
        "companyId":"20000000-0000-4000-8000-000000000001",
        "workspaceScopeId":"20000000-0000-4000-8000-000000000001"
      },
      "queryHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "filterHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "policyVersion":1,
      "bounds":{
        "maximumResults":5,
        "maximumCharacters":12000,
        "maximumTokens":4000,
        "maximumAgeHours":8760,
        "minimumConfidence":0,
        "timeoutMs":2000
      },
      "resultCount":0,
      "characterCount":0,
      "tokenEstimate":0,
      "latencyMs":0,
      "fallbackReason":"provider_unavailable",
      "indexSnapshotMarker":null,
      "citations":[]
    }
  }'
);

SELECT is(
  (SELECT facts FROM context_packet_extraction_probe LIMIT 1),
  '{"canonical":{"sku":"A-1"}}'::JSONB,
  'reserved transport provenance is removed from canonical facts'
);
SELECT is(
  (SELECT operational_context ->> 'provider' FROM context_packet_extraction_probe LIMIT 1),
  'supermemory',
  'reserved transport provenance is stored in the separate column'
);
SELECT throws_ok(
  $$INSERT INTO context_packet_extraction_probe(company_id, facts)
    VALUES (
      '20000000-0000-4000-8000-000000000001',
      '{"__mandalaOperationalContextV1":["invalid"]}'
    )$$,
  '22023',
  'invalid_context_packet_operational_context',
  'non-object provider provenance is rejected'
);
SELECT throws_ok(
  $$INSERT INTO context_packet_extraction_probe(company_id, facts, operational_context)
    SELECT
      '20000000-0000-4000-8000-000000000001',
      '{}'::JSONB,
      jsonb_set(
        operational_context,
        '{scope,companyId}',
        '"29999999-0000-4000-8000-000000000001"'::JSONB
      )
    FROM context_packet_extraction_probe
    LIMIT 1$$,
  '22023',
  'invalid_context_packet_operational_context',
  'provenance for another workspace is rejected'
);
SELECT throws_ok(
  $$INSERT INTO context_packet_extraction_probe(company_id, facts, operational_context)
    SELECT
      company_id,
      '{}'::JSONB,
      operational_context || '{"excerpt":"retrieved private text"}'::JSONB
    FROM context_packet_extraction_probe
    LIMIT 1$$,
  '22023',
  'invalid_context_packet_operational_context',
  'retrieved excerpts cannot be persisted as provenance'
);
SELECT throws_ok(
  $$INSERT INTO context_packet_extraction_probe(company_id, facts, operational_context)
    SELECT
      company_id,
      '{}'::JSONB,
      jsonb_set(operational_context, '{queryHash}', 'null'::JSONB)
    FROM context_packet_extraction_probe
    LIMIT 1$$,
  '22023',
  'invalid_context_packet_operational_context',
  'null required identity fields cannot bypass SQL comparisons'
);
SELECT throws_ok(
  $$INSERT INTO context_packet_extraction_probe(company_id, facts, operational_context)
    SELECT
      company_id,
      '{}'::JSONB,
      jsonb_set(operational_context, '{bounds,maximumResults}', '5.5'::JSONB)
    FROM context_packet_extraction_probe
    LIMIT 1$$,
  '22023',
  'invalid_context_packet_operational_context',
  'fractional integer bounds are rejected'
);
SELECT throws_ok(
  $$INSERT INTO context_packet_extraction_probe(company_id, facts, operational_context)
    SELECT
      company_id,
      '{}'::JSONB,
      jsonb_set(
        jsonb_set(operational_context, '{bounds,maximumCharacters}', '100'::JSONB),
        '{characterCount}',
        '101'::JSONB
      )
    FROM context_packet_extraction_probe
    LIMIT 1$$,
  '22023',
  'invalid_context_packet_operational_context',
  'actual counts cannot exceed configured retrieval bounds'
);
SELECT throws_ok(
  $$INSERT INTO context_packet_extraction_probe(company_id, facts, operational_context)
    SELECT
      company_id,
      '{}'::JSONB,
      jsonb_set(
        jsonb_set(
          jsonb_set(operational_context, '{provider}', '"off"'::JSONB),
          '{status}',
          '"complete"'::JSONB
        ),
        '{fallbackReason}',
        'null'::JSONB
      )
    FROM context_packet_extraction_probe
    LIMIT 1$$,
  '22023',
  'invalid_context_packet_operational_context',
  'the Off provider cannot claim a completed retrieval'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '21000000-0000-4000-8000-000000000099',
  'authenticated',
  'authenticated',
  'context-provenance-reader@example.test',
  '',
  now(),
  '{}',
  '{}',
  now(),
  now()
);
INSERT INTO public.companies (id, name, created_by) VALUES (
  '20000000-0000-4000-8000-000000000001',
  'Context Provenance Company',
  '21000000-0000-4000-8000-000000000099'
);
INSERT INTO public.company_memberships (company_id, user_id, role) VALUES (
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000099',
  'owner'
);
INSERT INTO public.agent_workflows (
  id, company_id, workflow_key, workflow_type, name, version, status, spec
) VALUES (
  '22000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'context_provenance_test',
  'context_test',
  'Context provenance test',
  '1.0.0',
  'active',
  '{}'
);
INSERT INTO public.workflow_runs (
  id, company_id, workflow_id, workflow_type, status, input
) VALUES (
  '23000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'context_test',
  'waiting_for_approval',
  '{}'
);
INSERT INTO public.workflow_events (
  id, company_id, workflow_run_id, workflow_id, event_key, event_type,
  origin, source_ref, payload, freshness_state, validation_status,
  validation_result
) VALUES (
  '24000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'context-provenance-event',
  'context_test',
  'fixture',
  '{}',
  '{}',
  'fresh',
  'pass',
  '{}'
);
INSERT INTO public.workflow_items (
  id, company_id, workflow_run_id, workflow_event_id, workflow_id, item_key,
  item_type, title, status, priority, related_records, owner_role
) VALUES (
  '25000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '24000000-0000-4000-8000-000000000001',
  '22000000-0000-4000-8000-000000000001',
  'context-provenance-item',
  'context_review',
  'Review context provenance',
  'active',
  50,
  '{}',
  'approver'
);
INSERT INTO public.workflow_context_packets (
  id, company_id, workflow_run_id, workflow_item_id, sources, facts,
  memory_refs, operational_context, freshness_state, warnings
)
SELECT
  '26000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '23000000-0000-4000-8000-000000000001',
  '25000000-0000-4000-8000-000000000001',
  '[]'::JSONB,
  '{}'::JSONB,
  '[]'::JSONB,
  operational_context,
  'fresh',
  '[]'::JSONB
FROM context_packet_extraction_probe
LIMIT 1;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"21000000-0000-4000-8000-000000000099","role":"authenticated"}',
  true
);
SELECT is(
  public.get_workflow_context_provenance_v1(
    '20000000-0000-4000-8000-000000000001',
    '26000000-0000-4000-8000-000000000001'
  ) ->> 'provider',
  'supermemory',
  'a workspace member can read bounded provenance through the controlled RPC'
);

SELECT * FROM finish();
ROLLBACK;
