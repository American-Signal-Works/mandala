-- The nullable-field hash correction intentionally changes one catalog hash
-- the first time a previously profiled nullable dataset is refreshed. Treat
-- that one-time normalization as compatible only when the current profile can
-- reconstruct the exact legacy hash already approved by a validated mapping.

create or replace function workflow_private.rebaseline_nullable_catalog_hashes_v1()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rebaselined_count integer := 0;
begin
  with candidate_catalogs as materialized (
    select
      catalog.id as catalog_id,
      catalog.company_id,
      catalog.source_key,
      catalog.record_type,
      catalog.schema_hash as normalized_schema_hash,
      encode(extensions.digest(convert_to(
        jsonb_build_object(
          'fields', coalesce(legacy_profile.fields, '[]'::jsonb),
          'relationships', catalog.relationship_profile
        )::text,
        'UTF8'
      ), 'sha256'), 'hex') as legacy_schema_hash
    from public.workspace_data_catalogs catalog
    cross join lateral (
      select jsonb_agg(
        legacy_field.value order by legacy_field.path, legacy_field.field_type
      ) as fields
      from (
        select
          field ->> 'path' as path,
          field ->> 'type' as field_type,
          jsonb_build_object(
            'path', field ->> 'path',
            'type', field ->> 'type'
          ) as value
        from jsonb_array_elements(catalog.field_profile) field

        union all

        select
          field ->> 'path' as path,
          'null' as field_type,
          jsonb_build_object(
            'path', field ->> 'path',
            'type', 'null'
          ) as value
        from jsonb_array_elements(catalog.field_profile) field
        where coalesce((field ->> 'nullable')::boolean, false)
      ) legacy_field
    ) legacy_profile
    where catalog.profile_status = 'drifted'
      and catalog.schema_hash is not null
  ), safe_rebaselines as materialized (
    select candidate.*
    from candidate_catalogs candidate
    where candidate.legacy_schema_hash <> candidate.normalized_schema_hash
      and exists (
        select 1
        from public.workspace_capability_mapping_datasets dataset
        join public.workspace_capability_mapping_versions mapping
          on mapping.id = dataset.mapping_version_id
         and mapping.company_id = dataset.company_id
        where dataset.company_id = candidate.company_id
          and dataset.source_key = candidate.source_key
          and dataset.record_type = candidate.record_type
          and dataset.expected_schema_hashes ? candidate.legacy_schema_hash
          and mapping.status = 'validated'
      )
  ), updated_datasets as (
    update public.workspace_capability_mapping_datasets dataset
    set
      expected_schema_hash = case
        when dataset.expected_schema_hash = rebaseline.legacy_schema_hash
        then rebaseline.normalized_schema_hash
        else dataset.expected_schema_hash
      end,
      expected_schema_hashes = (
        select jsonb_agg(deduplicated.replacement order by deduplicated.first_ordinal)
        from (
          select
            replacement.value as replacement,
            min(replacement.ordinality) as first_ordinal
          from (
            select
              case
                when element.value #>> '{}' = rebaseline.legacy_schema_hash
                then to_jsonb(rebaseline.normalized_schema_hash)
                else element.value
              end as value,
              element.ordinality
            from jsonb_array_elements(dataset.expected_schema_hashes)
              with ordinality as element(value, ordinality)
          ) replacement
          group by replacement.value
        ) deduplicated
      )
    from safe_rebaselines rebaseline
    where dataset.company_id = rebaseline.company_id
      and dataset.source_key = rebaseline.source_key
      and dataset.record_type = rebaseline.record_type
      and dataset.expected_schema_hashes ? rebaseline.legacy_schema_hash
      and exists (
        select 1
        from public.workspace_capability_mapping_versions mapping
        where mapping.id = dataset.mapping_version_id
          and mapping.company_id = dataset.company_id
          and mapping.status = 'validated'
      )
    returning rebaseline.catalog_id
  ), updated_catalogs as (
    update public.workspace_data_catalogs catalog
    set profile_status = 'ready'
    where catalog.id in (
      select distinct updated.catalog_id
      from updated_datasets updated
    )
    returning 1
  )
  select count(*)::integer
  into rebaselined_count
  from updated_catalogs;

  return rebaselined_count;
end;
$$;

revoke all on function workflow_private.rebaseline_nullable_catalog_hashes_v1()
  from public, anon, authenticated, service_role;

select workflow_private.rebaseline_nullable_catalog_hashes_v1();

