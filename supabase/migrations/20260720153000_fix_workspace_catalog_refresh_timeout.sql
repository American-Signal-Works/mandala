-- Catalog row counts and freshness are maintained transactionally by
-- external_records_mark_workspace_catalog_pending. Keep the synchronous
-- profile refresh bounded to schema and relationship discovery instead of
-- recounting every record in each pending dataset.

create or replace function public.refresh_workspace_data_catalog_v1(
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  refreshed_count integer := 0;
  detached_count integer := 0;
begin
  perform workflow_private.require_company_role(
    p_company_id,
    'admin',
    current_user_id
  );

  with target_scopes as materialized (
    select
      catalog.company_id,
      catalog.source_id,
      catalog.source_key,
      catalog.record_type,
      catalog.record_count,
      catalog.first_observed_at,
      catalog.freshest_observed_at
    from public.workspace_data_catalogs catalog
    where catalog.company_id = p_company_id
      and catalog.profile_status = 'pending'
  ), sampled_records as materialized (
    select
      scope.company_id,
      scope.source_id,
      scope.record_type,
      sample.payload
    from target_scopes scope
    cross join lateral (
      select record.payload
      from public.external_records record
      where record.company_id = scope.company_id
        and record.source_id = scope.source_id
        and record.record_type = scope.record_type
      order by record.updated_at desc, record.id
      limit 256
    ) sample
  ), field_counts as (
    select
      sample.company_id,
      sample.source_id,
      sample.record_type,
      field.key as field_name,
      jsonb_typeof(field.value) as field_type,
      count(*)::bigint as observed_count
    from sampled_records sample
    cross join lateral jsonb_each(sample.payload) field
    group by
      sample.company_id,
      sample.source_id,
      sample.record_type,
      field.key,
      jsonb_typeof(field.value)
  ), field_profiles as (
    select
      company_id,
      source_id,
      record_type,
      jsonb_agg(
        jsonb_build_object(
          'path', '/' || replace(replace(field_name, '~', '~0'), '/', '~1'),
          'type', field_type,
          'observedCount', observed_count,
          'classification', 'unreviewed',
          'modelAllowed', false
        ) order by field_name, field_type
      ) as fields,
      jsonb_agg(
        jsonb_build_object(
          'path', '/' || replace(replace(field_name, '~', '~0'), '/', '~1'),
          'type', field_type
        ) order by field_name, field_type
      ) as schema_fields
    from field_counts
    group by company_id, source_id, record_type
  ), relationship_profiles as (
    select
      scope.company_id,
      scope.source_id,
      scope.record_type,
      jsonb_agg(distinct jsonb_build_object(
        'relationship', link.relationship,
        'targetRecordType', target_record.record_type
      )) as relationships
    from target_scopes scope
    join public.external_record_links link
      on link.company_id = scope.company_id
    join public.external_records source_record
      on source_record.id = link.from_record_id
     and source_record.company_id = link.company_id
     and source_record.source_id = scope.source_id
     and source_record.record_type = scope.record_type
    join public.external_records target_record
      on target_record.id = link.to_record_id
     and target_record.company_id = link.company_id
    group by scope.company_id, scope.source_id, scope.record_type
  ), summaries as (
    select
      scope.company_id,
      scope.source_id,
      scope.source_key,
      scope.record_type,
      scope.record_count,
      scope.first_observed_at,
      scope.freshest_observed_at,
      coalesce(profile.fields, '[]'::jsonb) as fields,
      coalesce(profile.schema_fields, '[]'::jsonb) as schema_fields,
      coalesce(relationships.relationships, '[]'::jsonb) as relationships
    from target_scopes scope
    left join field_profiles profile
      on profile.company_id = scope.company_id
     and profile.source_id = scope.source_id
     and profile.record_type = scope.record_type
    left join relationship_profiles relationships
      on relationships.company_id = scope.company_id
     and relationships.source_id = scope.source_id
     and relationships.record_type = scope.record_type
  ), upserted as (
    insert into public.workspace_data_catalogs (
      company_id,
      source_id,
      source_key,
      record_type,
      record_count,
      first_observed_at,
      freshest_observed_at,
      field_profile,
      relationship_profile,
      schema_hash,
      profile_status,
      profiled_at
    )
    select
      summary.company_id,
      summary.source_id,
      summary.source_key,
      summary.record_type,
      summary.record_count,
      summary.first_observed_at,
      summary.freshest_observed_at,
      summary.fields,
      summary.relationships,
      encode(extensions.digest(convert_to(
        jsonb_build_object(
          'fields', summary.schema_fields,
          'relationships', summary.relationships
        )::text,
        'UTF8'
      ), 'sha256'), 'hex'),
      'ready',
      now()
    from summaries summary
    on conflict (company_id, source_id, record_type)
    do update set
      source_key = excluded.source_key,
      record_count = excluded.record_count,
      first_observed_at = excluded.first_observed_at,
      freshest_observed_at = excluded.freshest_observed_at,
      field_profile = excluded.field_profile,
      relationship_profile = excluded.relationship_profile,
      profile_status = case
        when public.workspace_data_catalogs.schema_hash is not null
         and public.workspace_data_catalogs.schema_hash <> excluded.schema_hash
        then 'drifted'
        else 'ready'
      end,
      schema_hash = excluded.schema_hash,
      catalog_version = case
        when public.workspace_data_catalogs.schema_hash is distinct from excluded.schema_hash
        then public.workspace_data_catalogs.catalog_version + 1
        else public.workspace_data_catalogs.catalog_version
      end,
      profiled_at = now()
    returning 1
  )
  select count(*) into refreshed_count from upserted;

  update public.workspace_data_catalogs catalog
  set
    profile_status = 'detached',
    catalog_version = catalog.catalog_version + 1
  where catalog.company_id = p_company_id
    and catalog.profile_status <> 'detached'
    and catalog.record_count = 0;
  get diagnostics detached_count = row_count;

  return jsonb_build_object(
    'companyId', p_company_id,
    'catalogsRefreshed', refreshed_count,
    'catalogsDetached', detached_count,
    'profiledAt', now()
  );
end;
$$;

revoke all on function public.refresh_workspace_data_catalog_v1(uuid)
  from public, anon;
grant execute on function public.refresh_workspace_data_catalog_v1(uuid)
  to authenticated;

notify pgrst, 'reload schema';
