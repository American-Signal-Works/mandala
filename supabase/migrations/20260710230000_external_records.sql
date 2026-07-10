-- External records: company-scoped durable store for business records synced
-- from external systems (inventory platforms, project boards, commerce, email).
-- Workflow-agnostic by design: record kinds are DATA (record_type values), never
-- table names, mirroring the agent workflow harness convention. Procurement is
-- only the first consumer.
--
-- Conventions follow 20260709174153_agent_workflow_harness.sql:
--   company_id scoping + has_company_role() RLS, UNIQUE (id, company_id),
--   composite child FKs, touch_updated_at triggers.
-- Note: grants below name service_role explicitly — default privileges for
-- service_role are not guaranteed across CLI versions (bit us locally).

-- A connector instance registered for a company (e.g. one ShipHero account,
-- one Trello board). Sync state lives here so freshness is queryable per source.
CREATE TABLE external_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sync_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle', 'syncing', 'error')),
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_key),
  UNIQUE (id, company_id)
);

-- One row per external business record (a vendor, a purchase order, an
-- inventory position, a sales order, a board card, a mapping row, ...).
-- record_type is free-form per source; payload holds the normalized record.
CREATE TABLE external_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_id UUID NOT NULL,
  record_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  pulled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_id, record_type, external_id),
  UNIQUE (id, company_id),
  FOREIGN KEY (source_id, company_id)
    REFERENCES external_sources (id, company_id) ON DELETE CASCADE
);

CREATE INDEX external_records_type_idx
  ON external_records (company_id, record_type, pulled_at DESC);
CREATE INDEX external_records_payload_idx
  ON external_records USING gin (payload jsonb_path_ops);

-- Typed relationships between records (e.g. purchase_order -> vendor,
-- line -> parent order) without encoding domain names into the schema.
CREATE TABLE external_record_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_record_id UUID NOT NULL,
  to_record_id UUID NOT NULL,
  relationship TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, from_record_id, to_record_id, relationship),
  UNIQUE (id, company_id),
  FOREIGN KEY (from_record_id, company_id)
    REFERENCES external_records (id, company_id) ON DELETE CASCADE,
  FOREIGN KEY (to_record_id, company_id)
    REFERENCES external_records (id, company_id) ON DELETE CASCADE
);

CREATE INDEX external_record_links_from_idx
  ON external_record_links (company_id, from_record_id, relationship);
CREATE INDEX external_record_links_to_idx
  ON external_record_links (company_id, to_record_id, relationship);

CREATE TRIGGER external_sources_touch BEFORE UPDATE ON external_sources
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER external_records_touch BEFORE UPDATE ON external_records
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE external_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_record_links ENABLE ROW LEVEL SECURITY;

-- Reads: any active member of the company.
CREATE POLICY external_sources_member_select ON external_sources
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY external_records_member_select ON external_records
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

CREATE POLICY external_record_links_member_select ON external_record_links
  FOR SELECT TO authenticated
  USING (public.has_company_role(company_id, 'viewer'));

-- Writes: connector/sync jobs run server-side with the service role; end
-- users do not write external records directly. Admins may manage sources.
CREATE POLICY external_sources_admin_insert ON external_sources
  FOR INSERT TO authenticated
  WITH CHECK (public.has_company_role(company_id, 'admin'));

CREATE POLICY external_sources_admin_update ON external_sources
  FOR UPDATE TO authenticated
  USING (public.has_company_role(company_id, 'admin'))
  WITH CHECK (public.has_company_role(company_id, 'admin'));

CREATE POLICY external_sources_admin_delete ON external_sources
  FOR DELETE TO authenticated
  USING (public.has_company_role(company_id, 'admin'));

-- Members may inspect source identity and freshness, but connector config and
-- raw sync errors stay service-only because they may contain sensitive data.
REVOKE ALL ON external_sources, external_records, external_record_links
  FROM anon, authenticated;

GRANT SELECT (
  id,
  company_id,
  source_key,
  kind,
  name,
  sync_status,
  last_synced_at,
  created_at,
  updated_at
) ON external_sources TO authenticated;
GRANT INSERT (company_id, source_key, kind, name)
  ON external_sources TO authenticated;
GRANT UPDATE (source_key, kind, name)
  ON external_sources TO authenticated;
GRANT DELETE ON external_sources TO authenticated;

GRANT SELECT ON external_records, external_record_links TO authenticated;
GRANT ALL ON external_sources, external_records, external_record_links
  TO service_role;
