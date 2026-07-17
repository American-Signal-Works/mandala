-- Keep the exact Sandbox persistence fingerprint fast as imported data grows.
-- The proof reads the latest mutation clock and exact company-scoped row count;
-- including the row id allows PostgreSQL to satisfy that read from this narrow
-- index without scanning the large JSON payload table.
create index if not exists external_records_company_updated_at_idx
  on public.external_records (company_id, updated_at desc)
  include (id);
