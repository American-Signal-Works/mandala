BEGIN;
SELECT plan(19);

SELECT has_function(
  'public',
  'get_sandbox_workspace_snapshot_v1',
  ARRAY['uuid', 'integer'],
  'the real-data Sandbox exposes a bounded read-only snapshot function'
);
SELECT is(
  has_function_privilege(
    'anon',
    'public.get_sandbox_workspace_snapshot_v1(uuid,integer)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot open a Sandbox snapshot'
);
SELECT is(
  has_function_privilege(
    'authenticated',
    'public.get_sandbox_workspace_snapshot_v1(uuid,integer)',
    'EXECUTE'
  ),
  true,
  'authenticated callers can open a Sandbox snapshot through RLS'
);
SELECT is(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'public.get_sandbox_workspace_snapshot_v1(uuid,integer)'::REGPROCEDURE),
  false,
  'the exposed Sandbox RPC remains security invoker'
);
SELECT is(
  (SELECT prosecdef FROM pg_proc
   WHERE oid = 'sandbox_private.build_workspace_snapshot_v1(uuid,integer)'::REGPROCEDURE),
  true,
  'the owner-level projection is isolated in a private security-definer helper'
);
SELECT is(
  has_schema_privilege('anon', 'sandbox_private', 'USAGE'),
  false,
  'anonymous callers cannot resolve the private Sandbox helper'
);
SELECT is(
  has_schema_privilege('authenticated', 'sandbox_private', 'USAGE'),
  true,
  'authenticated callers can reach the private helper only through its membership gate'
);
SELECT is(
  has_function_privilege(
    'anon',
    'sandbox_private.build_workspace_snapshot_v1(uuid,integer)',
    'EXECUTE'
  ),
  false,
  'anonymous callers cannot execute the private projection'
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'sandbox-viewer@example.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'sandbox-other@example.test', '', now(), '{}', '{}', now(), now());

INSERT INTO public.companies (id, name, created_by)
VALUES
  ('a2000000-0000-4000-8000-000000000001', 'Sandbox Workspace', 'a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002', 'Other Workspace', 'a1000000-0000-4000-8000-000000000002');

INSERT INTO public.company_memberships (company_id, user_id, role, status)
VALUES
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'viewer', 'active'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'owner', 'active');

INSERT INTO public.external_sources (
  id, company_id, source_key, kind, name, sync_status, last_synced_at
)
VALUES
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'shiphero', 'inventory_platform', 'ShipHero', 'idle', now()),
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'curated', 'curated', 'Curated mappings', 'idle', now()),
  ('a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'trello', 'project_board', 'Trello', 'idle', now()),
  ('a3000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000002', 'other', 'inventory_platform', 'Other source', 'idle', now());

INSERT INTO public.external_records (
  id, company_id, source_id, record_type, external_id, payload, pulled_at
)
VALUES
  ('a4000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'inventory_position', 'SKU-REAL@warehouse',
    '{"sku":"SKU-REAL","product_name":"Real Product","on_hand":12,"allocated":2,"available":-6,"backorder":2,"reorder_level":20,"reorder_amount":30,"warehouse_id":"private-warehouse","unrestricted_secret":"must-not-leak"}', now()),
  ('a4000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'sales_order', 'SO-REAL',
    jsonb_build_object('order_date', current_date::TEXT, 'fulfillment_status', 'fulfilled', 'lines', jsonb_build_array(jsonb_build_object('sku','SKU-REAL','quantity',7,'price',10))), now()),
  ('a4000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'purchase_order', 'PO-REAL',
    jsonb_build_object('po_date', current_date::TEXT, 'fulfillment_status', 'pending', 'lines', jsonb_build_array(jsonb_build_object('sku','SKU-REAL','quantity',5,'price',4))), now()),
  ('a4000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'product_vendor', 'SKU-REAL@vendor',
    '{"sku":"SKU-REAL","vendor_name":"Real Vendor","vendor_sku":"V-SKU-REAL","vendor_cost":4}', now()),
  ('a4000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'sku_vendor_map', 'SKU-REAL',
    '{"sku":"SKU-REAL","vendor":"Real Vendor","vendor_sku":"V-SKU-REAL","confidence":0.98,"confirmed":true,"source":"curated"}', now()),
  ('a4000000-0000-4000-8000-000000000006', 'a2000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'board_card', 'CARD-REAL',
    '{"sku":"SKU-REAL","name":"Real card","closed":false,"list_name":"Purchase Order Creation"}', now()),
  ('a4000000-0000-4000-8000-000000000007', 'a2000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000004', 'inventory_position', 'SKU-OTHER',
    '{"sku":"SKU-OTHER","product_name":"Other Product","available":0,"reorder_level":10,"reorder_amount":10}', now());

SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT set_config(
  'test.sandbox_snapshot',
  public.get_sandbox_workspace_snapshot_v1(
    'a2000000-0000-4000-8000-000000000001', 25
  )::TEXT,
  true
);

SELECT is(
  current_setting('test.sandbox_snapshot')::JSONB ->> 'mode',
  'sandbox',
  'the snapshot is explicitly labeled Sandbox'
);
SELECT is(
  current_setting('test.sandbox_snapshot')::JSONB ->> 'ephemeral',
  'true',
  'the snapshot states that all resulting work is ephemeral'
);
SELECT is(
  (current_setting('test.sandbox_snapshot')::JSONB ->> 'recordCount')::INTEGER,
  6,
  'the viewer sees only real records from the selected workspace'
);
SELECT is(
  jsonb_array_length(current_setting('test.sandbox_snapshot')::JSONB -> 'sources'),
  3,
  'the snapshot preserves all selected workspace source identities'
);
SELECT is(
  current_setting('test.sandbox_snapshot')::JSONB #>> '{candidates,0,sku}',
  'SKU-REAL',
  'the snapshot creates a review candidate from real inventory'
);
SELECT is(
  (current_setting('test.sandbox_snapshot')::JSONB #>> '{candidates,0,inventory,available}')::NUMERIC,
  (-6)::NUMERIC,
  'legitimate negative available inventory remains visible to the reviewer'
);
SELECT is(
  (current_setting('test.sandbox_snapshot')::JSONB #>> '{candidates,0,recommendation,quantity}')::NUMERIC,
  25::NUMERIC,
  'the recommendation accounts for the existing pending purchase order'
);
SELECT is(
  current_setting('test.sandbox_snapshot')::JSONB #>> '{candidates,0,recommendation,status}',
  'ready_for_review',
  'fresh mapped data is ready for temporary review'
);
SELECT ok(
  current_setting('test.sandbox_snapshot') NOT LIKE '%must-not-leak%'
    AND current_setting('test.sandbox_snapshot') NOT LIKE '%private-warehouse%',
  'unrestricted provider payload fields never cross the Sandbox projection'
);
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM public.external_records),
  6,
  'opening a Sandbox snapshot creates no provider or application records'
);

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (public.get_sandbox_workspace_snapshot_v1(
    'a2000000-0000-4000-8000-000000000001', 25
  ) ->> 'recordCount')::INTEGER,
  0,
  'a different workspace member receives no cross-tenant data'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
