-- Active workflow snapshots must carry the real workspace mappings that were
-- confirmed by a prior real-data Sandbox run. Synthetic readiness runs create
-- a newer capability snapshot, so promote the latest compatible mapping set
-- into that snapshot immediately before it becomes active.

create or replace function workflow_private.ensure_workspace_mappings_for_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_mapping_count integer;
  bound_mapping_count integer;
  source_mappings jsonb;
begin
  select count(distinct binding.requirement_key)
  into required_mapping_count
  from public.workflow_capability_bindings binding
  join public.company_connector_capability_grants grant_record
    on grant_record.id = binding.grant_id
   and grant_record.company_id = binding.company_id
   and grant_record.capability_version_id = binding.capability_version_id
  join public.company_connector_installations installation
    on installation.id = grant_record.installation_id
   and installation.company_id = grant_record.company_id
  join public.connector_definition_versions connector_version
    on connector_version.id = installation.connector_version_id
  join public.connector_definitions connector
    on connector.id = connector_version.connector_definition_id
  where binding.company_id = new.company_id
    and binding.binding_snapshot_id = new.binding_snapshot_id
    and connector.connector_key = 'mandala.workspace-data';

  if required_mapping_count = 0 then
    return new;
  end if;

  select count(distinct mapping.requirement_key)
  into bound_mapping_count
  from public.workflow_workspace_mapping_bindings mapping
  where mapping.company_id = new.company_id
    and mapping.binding_snapshot_id = new.binding_snapshot_id
    and exists (
      select 1
      from public.workflow_capability_bindings binding
      join public.company_connector_capability_grants grant_record
        on grant_record.id = binding.grant_id
       and grant_record.company_id = binding.company_id
       and grant_record.capability_version_id = binding.capability_version_id
      join public.company_connector_installations installation
        on installation.id = grant_record.installation_id
       and installation.company_id = grant_record.company_id
      join public.connector_definition_versions connector_version
        on connector_version.id = installation.connector_version_id
      join public.connector_definitions connector
        on connector.id = connector_version.connector_definition_id
      where binding.company_id = new.company_id
        and binding.binding_snapshot_id = new.binding_snapshot_id
        and binding.requirement_key = mapping.requirement_key
        and connector.connector_key = 'mandala.workspace-data'
    );

  if bound_mapping_count = required_mapping_count then
    return new;
  end if;
  if bound_mapping_count <> 0 then
    raise exception 'workspace_mapping_snapshot_incomplete'
      using errcode = '55000';
  end if;

  select candidate.mappings
  into source_mappings
  from (
    select
      snapshot.id,
      snapshot.created_at,
      jsonb_agg(
        jsonb_build_object(
          'requirementKey', mapping.requirement_key,
          'mappingVersionId', mapping.mapping_version_id
        )
        order by mapping.requirement_key
      ) as mappings
    from public.workflow_binding_snapshots snapshot
    join public.workflow_binding_snapshots target_snapshot
      on target_snapshot.id = new.binding_snapshot_id
     and target_snapshot.company_id = new.company_id
     and target_snapshot.workflow_id = new.workflow_id
    join public.workflow_workspace_mapping_bindings mapping
      on mapping.binding_snapshot_id = snapshot.id
     and mapping.company_id = snapshot.company_id
    where snapshot.company_id = new.company_id
      and snapshot.workflow_id = new.workflow_id
      and snapshot.id <> new.binding_snapshot_id
      and snapshot.manifest_hash = target_snapshot.manifest_hash
      and snapshot.grant_digest = target_snapshot.grant_digest
      and not exists (
        select 1
        from public.workflow_binding_snapshot_events event
        where event.company_id = snapshot.company_id
          and event.binding_snapshot_id = snapshot.id
          and event.event_type = 'invalidated'
      )
      and exists (
        select 1
        from public.workflow_capability_bindings binding
        join public.company_connector_capability_grants grant_record
          on grant_record.id = binding.grant_id
         and grant_record.company_id = binding.company_id
         and grant_record.capability_version_id = binding.capability_version_id
        join public.company_connector_installations installation
          on installation.id = grant_record.installation_id
         and installation.company_id = grant_record.company_id
        join public.connector_definition_versions connector_version
          on connector_version.id = installation.connector_version_id
        join public.connector_definitions connector
          on connector.id = connector_version.connector_definition_id
        where binding.company_id = new.company_id
          and binding.binding_snapshot_id = new.binding_snapshot_id
          and binding.requirement_key = mapping.requirement_key
          and connector.connector_key = 'mandala.workspace-data'
      )
    group by snapshot.id, snapshot.created_at
    having count(distinct mapping.requirement_key) = required_mapping_count
    order by snapshot.created_at desc, snapshot.id desc
    limit 1
  ) candidate;

  if source_mappings is null then
    raise exception 'workspace_mapping_snapshot_not_ready'
      using errcode = '55000';
  end if;

  -- Connector imports intentionally mark touched catalogs pending. Refresh the
  -- bounded profiles here so activation cannot lose a race with normal sync.
  perform public.refresh_workspace_data_catalog_v1(new.company_id);

  perform public.bind_workspace_mappings_v1(
    new.company_id,
    new.binding_snapshot_id,
    source_mappings
  );

  select count(distinct mapping.requirement_key)
  into bound_mapping_count
  from public.workflow_workspace_mapping_bindings mapping
  where mapping.company_id = new.company_id
    and mapping.binding_snapshot_id = new.binding_snapshot_id;

  if bound_mapping_count <> required_mapping_count then
    raise exception 'workspace_mapping_snapshot_incomplete'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function workflow_private.ensure_workspace_mappings_for_activation()
  from public, anon, authenticated;

create trigger workflow_activations_ensure_workspace_mappings
before insert or update of workflow_id, binding_snapshot_id
on public.workflow_activations
for each row
execute function workflow_private.ensure_workspace_mappings_for_activation();

-- Null is a value-state, not a different field type. Keep null observations in
-- the diagnostic profile while excluding them from the schema identity. This
-- makes the hash stable as connector updates move nullable rows in and out of
-- the bounded 256-record profiling window.

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
  ), field_nulls as (
    select
      sample.company_id,
      sample.source_id,
      sample.record_type,
      field.key as field_name,
      count(*) filter (where jsonb_typeof(field.value) = 'null')::bigint
        as null_observed_count
    from sampled_records sample
    cross join lateral jsonb_each(sample.payload) field
    group by
      sample.company_id,
      sample.source_id,
      sample.record_type,
      field.key
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
    where jsonb_typeof(field.value) <> 'null'
    group by
      sample.company_id,
      sample.source_id,
      sample.record_type,
      field.key,
      jsonb_typeof(field.value)
  ), field_profiles as (
    select
      counts.company_id,
      counts.source_id,
      counts.record_type,
      jsonb_agg(
        jsonb_build_object(
          'path', '/' || replace(replace(counts.field_name, '~', '~0'), '/', '~1'),
          'type', counts.field_type,
          'observedCount', counts.observed_count,
          'nullObservedCount', coalesce(nulls.null_observed_count, 0),
          'nullable', coalesce(nulls.null_observed_count, 0) > 0,
          'classification', 'unreviewed',
          'modelAllowed', false
        ) order by counts.field_name, counts.field_type
      ) as fields,
      jsonb_agg(
        jsonb_build_object(
          'path', '/' || replace(replace(counts.field_name, '~', '~0'), '/', '~1'),
          'type', counts.field_type
        ) order by counts.field_name, counts.field_type
      ) as schema_fields
    from field_counts counts
    left join field_nulls nulls
      on nulls.company_id = counts.company_id
     and nulls.source_id = counts.source_id
     and nulls.record_type = counts.record_type
     and nulls.field_name = counts.field_name
    group by counts.company_id, counts.source_id, counts.record_type
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
