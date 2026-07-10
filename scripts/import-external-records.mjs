// Bootstrap import: copy business records from an existing Supabase project
// (the DK ERP prototype database) into this stack's external_records store,
// under a company. Idempotent — upserts on (company_id, record_type,
// external_id); safe to re-run for refreshes until real per-source connectors
// (ShipHero GraphQL, Trello API) replace it.
//
// Env:
//   SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SECRET_KEY  — project to read from
//   TARGET_SUPABASE_URL   (default http://127.0.0.1:54321)
//   TARGET_SERVICE_ROLE_KEY — e.g. $(supabase status -o json | jq -r .SERVICE_ROLE_KEY)
//   IMPORT_COMPANY_ID / IMPORT_COMPANY_NAME — target company (created if absent)
//   IMPORT_OWNER_EMAIL    (default seed@example.com) — must already exist in auth
//
// Run: node scripts/import-external-records.mjs

const SRC_URL = process.env.SOURCE_SUPABASE_URL ?? "";
const SRC_KEY = process.env.SOURCE_SUPABASE_SECRET_KEY ?? "";
const TARGET_URL = process.env.TARGET_SUPABASE_URL ?? "http://127.0.0.1:54321";
const TARGET_KEY = process.env.TARGET_SERVICE_ROLE_KEY ?? "";
const COMPANY_ID =
  process.env.IMPORT_COMPANY_ID ?? "70000000-0000-4000-8000-000000000001";
const COMPANY_NAME = process.env.IMPORT_COMPANY_NAME ?? "Dirt King (Sandbox)";
const OWNER_EMAIL = process.env.IMPORT_OWNER_EMAIL ?? "seed@example.com";
const RUN_STAMP = new Date().toISOString();

for (const [name, value] of [
  ["SOURCE_SUPABASE_URL", SRC_URL],
  ["SOURCE_SUPABASE_SECRET_KEY", SRC_KEY],
  ["TARGET_SERVICE_ROLE_KEY", TARGET_KEY],
]) {
  if (!value) {
    console.error(`${name} not set.`);
    process.exit(1);
  }
}

function headers(key, extra = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

// Paginate until a partial page — PostgREST silently caps un-ranged GETs.
async function pullAll(table, select = "*") {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(
      `${SRC_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`,
      {
        headers: headers(SRC_KEY, {
          Range: `${from}-${from + pageSize - 1}`,
          "Range-Unit": "items",
        }),
      }
    );
    if (!res.ok)
      throw new Error(`${table} pull failed: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  console.log(`  pulled ${table}: ${rows.length}`);
  return rows;
}

function dedupeRecords(rows) {
  // Last occurrence wins per (record_type, external_id) — sources can contain
  // the same external entity twice (e.g. re-pulled provider rows).
  const map = new Map();
  for (const r of rows) map.set(`${r.record_type} ${r.external_id}`, r);
  const out = [...map.values()];
  if (out.length !== rows.length)
    console.log(`  deduped ${rows.length - out.length} duplicate external ids`);
  return out;
}

async function targetUpsert(table, rows, onConflict) {
  if (table === "external_records") rows = dedupeRecords(rows);
  const batch = 1000;
  for (let i = 0; i < rows.length; i += batch) {
    const res = await fetch(`${TARGET_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: headers(TARGET_KEY, {
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify(rows.slice(i, i + batch)),
    });
    if (!res.ok)
      throw new Error(`${table} upsert failed: ${res.status} ${await res.text()}`);
  }
}

async function targetSelect(pathAndQuery) {
  const res = await fetch(`${TARGET_URL}/rest/v1/${pathAndQuery}`, {
    headers: headers(TARGET_KEY),
  });
  if (!res.ok) throw new Error(`select failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function findOwnerUserId() {
  const res = await fetch(`${TARGET_URL}/auth/v1/admin/users?page=1&per_page=100`, {
    headers: headers(TARGET_KEY),
  });
  if (!res.ok) throw new Error(`list users failed: ${res.status}`);
  const { users } = await res.json();
  const user = (users ?? []).find((u) => u.email === OWNER_EMAIL);
  if (!user)
    throw new Error(`Owner ${OWNER_EMAIL} not found — create the user first (pnpm seed).`);
  return user.id;
}

async function ensureCompany() {
  const userId = await findOwnerUserId();
  await targetUpsert(
    "companies",
    [{ id: COMPANY_ID, name: COMPANY_NAME, created_by: userId }],
    "id"
  );
  await targetUpsert(
    "company_memberships",
    [{ company_id: COMPANY_ID, user_id: userId, role: "owner", status: "active" }],
    "company_id,user_id"
  );
  await targetUpsert(
    "company_approval_policies",
    [
      {
        company_id: COMPANY_ID,
        workflow_type: "procurement_reorder",
        action_type: "execute_mock_purchase_order",
        minimum_role: "approver",
        require_human_approval: true,
        require_warning_acknowledgement: true,
      },
    ],
    "company_id,workflow_type,action_type"
  );
  console.log(`company ready: ${COMPANY_NAME} (${COMPANY_ID})`);
}

const SOURCES = [
  { source_key: "shiphero", kind: "inventory_platform", name: "ShipHero" },
  { source_key: "trello", kind: "project_board", name: "Trello (procurement board)" },
  { source_key: "curated", kind: "curated", name: "Curated mappings" },
];
const sourceIds = {};

async function ensureSources() {
  await targetUpsert(
    "external_sources",
    SOURCES.map((s) => ({ ...s, company_id: COMPANY_ID, last_synced_at: RUN_STAMP })),
    "company_id,source_key"
  );
  const rows = await targetSelect(
    `external_sources?company_id=eq.${COMPANY_ID}&select=id,source_key`
  );
  for (const r of rows) sourceIds[r.source_key] = r.id;
  console.log(`sources ready: ${Object.keys(sourceIds).join(", ")}`);
}

function rec(sourceKey, recordType, externalId, payload, pulledAt) {
  return {
    company_id: COMPANY_ID,
    source_id: sourceIds[sourceKey],
    record_type: recordType,
    external_id: String(externalId),
    payload,
    pulled_at: pulledAt ?? RUN_STAMP,
  };
}

function groupBy(rows, keyFn) {
  const map = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

async function run() {
  console.log("== company & sources ==");
  await ensureCompany();
  await ensureSources();

  console.log("== vendors ==");
  const vendors = await pullAll("vendors");
  await targetUpsert(
    "external_records",
    vendors.map((v) =>
      rec("shiphero", "vendor", v.external_id ?? v.id, {
        name: v.name,
        source: v.source,
        source_row_id: v.id,
      })
    ),
    "company_id,record_type,external_id"
  );

  console.log("== purchase orders (+lines nested) ==");
  const pos = await pullAll(
    "purchase_orders",
    "id,external_id,source,po_number,vendor_id,po_date,fulfillment_status,subtotal,total_price"
  );
  const poLines = await pullAll(
    "purchase_order_line_items",
    "purchase_order_id,sku,product_name,quantity,price"
  );
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const linesByPo = groupBy(poLines, (l) => l.purchase_order_id);
  await targetUpsert(
    "external_records",
    pos.map((p) =>
      rec("shiphero", "purchase_order", p.external_id ?? p.id, {
        po_number: p.po_number,
        vendor_name: vendorById.get(p.vendor_id)?.name ?? null,
        vendor_external_id:
          vendorById.get(p.vendor_id)?.external_id ?? p.vendor_id ?? null,
        po_date: p.po_date,
        fulfillment_status: p.fulfillment_status,
        subtotal: p.subtotal,
        total_price: p.total_price,
        lines: (linesByPo.get(p.id) ?? []).map((l) => ({
          sku: l.sku,
          product_name: l.product_name,
          quantity: l.quantity,
          price: l.price,
        })),
        source_row_id: p.id,
      })
    ),
    "company_id,record_type,external_id"
  );

  console.log("== inventory positions ==");
  const inventory = await pullAll(
    "inventory",
    "sku,product_name,warehouse_id,on_hand,allocated,available,backorder,reorder_level,reorder_amount,pulled_at"
  );
  await targetUpsert(
    "external_records",
    inventory.map((i) =>
      rec(
        "shiphero",
        "inventory_position",
        `${i.sku}@${i.warehouse_id ?? "default"}`,
        {
          sku: i.sku,
          product_name: i.product_name,
          warehouse_id: i.warehouse_id,
          on_hand: i.on_hand,
          allocated: i.allocated,
          available: i.available,
          backorder: i.backorder,
          reorder_level: i.reorder_level,
          reorder_amount: i.reorder_amount,
        },
        i.pulled_at
      )
    ),
    "company_id,record_type,external_id"
  );

  console.log("== sales orders (+lines nested) ==");
  const sales = await pullAll(
    "sales_orders",
    "id,external_id,order_number,order_date,fulfillment_status,total_price"
  );
  const salesLines = await pullAll(
    "sales_order_line_items",
    "sales_order_id,sku,product_name,quantity,price"
  );
  const linesBySale = groupBy(salesLines, (l) => l.sales_order_id);
  await targetUpsert(
    "external_records",
    sales.map((s) =>
      rec("shiphero", "sales_order", s.external_id ?? s.id, {
        order_number: s.order_number,
        order_date: s.order_date,
        fulfillment_status: s.fulfillment_status,
        total_price: s.total_price,
        lines: (linesBySale.get(s.id) ?? []).map((l) => ({
          sku: l.sku,
          product_name: l.product_name,
          quantity: l.quantity,
          price: l.price,
        })),
        source_row_id: s.id,
      })
    ),
    "company_id,record_type,external_id"
  );

  console.log("== product-vendor assignments ==");
  const productVendors = await pullAll("product_vendors");
  await targetUpsert(
    "external_records",
    productVendors.map((pv) =>
      rec("shiphero", "product_vendor", pv.id, {
        sku: pv.sku,
        vendor_external_id: pv.vendor_external_id,
        vendor_name: pv.vendor_name,
        vendor_sku: pv.vendor_sku,
        vendor_cost: pv.vendor_cost,
      })
    ),
    "company_id,record_type,external_id"
  );

  console.log("== sku-vendor map ==");
  const skuVendorMap = await pullAll("sku_vendor_map");
  await targetUpsert(
    "external_records",
    skuVendorMap.map((m) =>
      rec("curated", "sku_vendor_map", m.sku, {
        sku: m.sku,
        vendor: m.vendor,
        vendor_sku: m.vendor_sku,
        source: m.source,
        confidence: m.confidence,
        confirmed: m.confirmed,
      })
    ),
    "company_id,record_type,external_id"
  );

  console.log("== vendor aliases ==");
  const aliases = await pullAll("vendor_aliases");
  await targetUpsert(
    "external_records",
    aliases.map((a) =>
      rec("curated", "vendor_alias", a.alias, {
        alias: a.alias,
        canonical: a.canonical,
      })
    ),
    "company_id,record_type,external_id"
  );

  console.log("== board cards (procurement board history) ==");
  const cards = await pullAll(
    "trello_procurement_cards",
    "id,name,list_name,closed,labels,vendor,sku,order_number,order_quantity,order_type,warehouse,po_ship_date,po_expected_date,po_confirmed_date,po_received_date,due,card_created_at,last_activity"
  );
  await targetUpsert(
    "external_records",
    cards.map((c) =>
      rec("trello", "board_card", c.id, {
        name: c.name,
        list_name: c.list_name,
        closed: c.closed,
        labels: c.labels,
        vendor: c.vendor,
        sku: c.sku,
        order_number: c.order_number,
        order_quantity: c.order_quantity,
        order_type: c.order_type,
        warehouse: c.warehouse,
        po_ship_date: c.po_ship_date,
        po_expected_date: c.po_expected_date,
        po_confirmed_date: c.po_confirmed_date,
        po_received_date: c.po_received_date,
        due: c.due,
        card_created_at: c.card_created_at,
        last_activity: c.last_activity,
      })
    ),
    "company_id,record_type,external_id"
  );

  // Mark sources synced.
  await targetUpsert(
    "external_sources",
    SOURCES.map((s) => ({
      ...s,
      company_id: COMPANY_ID,
      sync_status: "idle",
      last_synced_at: new Date().toISOString(),
    })),
    "company_id,source_key"
  );
  console.log("done.");
}

run().catch((err) => {
  console.error("IMPORT FAILED:", err.message);
  process.exit(1);
});
