-- A reviewed mapping version freezes the exact catalog hashes an admin
-- accepted. Once that validated dataset row exists, the matching drifted
-- catalog can return to ready. Hash mismatches for every other mapping remain
-- blocked by bind_workspace_mappings_v1.

create or replace function workflow_private.acknowledge_confirmed_catalog_drift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.workspace_capability_mapping_versions mapping
    where mapping.id = new.mapping_version_id
      and mapping.company_id = new.company_id
      and mapping.status = 'validated'
  ) then
    update public.workspace_data_catalogs catalog
    set profile_status = 'ready'
    where catalog.company_id = new.company_id
      and catalog.record_type = new.record_type
      and (new.source_key is null or catalog.source_key = new.source_key)
      and catalog.profile_status = 'drifted'
      and new.expected_schema_hashes ? catalog.schema_hash;
  end if;

  return new;
end;
$$;

revoke all
on function workflow_private.acknowledge_confirmed_catalog_drift()
from public, anon, authenticated, service_role;

drop trigger if exists workspace_mapping_dataset_acknowledge_confirmed_drift
on public.workspace_capability_mapping_datasets;

create trigger workspace_mapping_dataset_acknowledge_confirmed_drift
after insert on public.workspace_capability_mapping_datasets
for each row
execute function workflow_private.acknowledge_confirmed_catalog_drift();
