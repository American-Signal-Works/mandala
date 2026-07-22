-- Work-item detail needs the latest persisted decision and execution attempt,
-- but the underlying history tables intentionally remain private. Expose only
-- the bounded public projection after enforcing workspace membership.

create or replace function public.get_workflow_item_outcome_v1(
  p_company_id uuid,
  p_workflow_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  decision_result jsonb;
  attempt_result jsonb;
begin
  perform workflow_private.require_company_role(
    p_company_id,
    'viewer',
    current_user_id
  );

  select jsonb_build_object(
    'id', decision.id,
    'action_draft_id', decision.action_draft_id,
    'decision', decision.decision,
    'reason', decision.reason,
    'warnings_acknowledged', decision.warnings_acknowledged,
    'created_at', decision.created_at
  )
  into decision_result
  from public.workflow_decisions decision
  where decision.company_id = p_company_id
    and decision.workflow_item_id = p_workflow_item_id
  order by decision.created_at desc, decision.id desc
  limit 1;

  select jsonb_build_object(
    'id', attempt.id,
    'action_draft_id', attempt.action_draft_id,
    'decision_id', attempt.decision_id,
    'action_type', attempt.action_type,
    'mode', attempt.mode,
    'status', attempt.status,
    'result_payload', attempt.result_payload,
    'mock_external_id', attempt.mock_external_id,
    'error_message', attempt.error_message,
    'created_at', attempt.created_at,
    'completed_at', attempt.completed_at
  )
  into attempt_result
  from public.workflow_action_attempts attempt
  where attempt.company_id = p_company_id
    and attempt.workflow_item_id = p_workflow_item_id
  order by attempt.created_at desc, attempt.id desc
  limit 1;

  return jsonb_build_object(
    'decision', decision_result,
    'attempt', attempt_result
  );
end;
$$;

revoke all on function public.get_workflow_item_outcome_v1(uuid, uuid)
  from public, anon;
grant execute on function public.get_workflow_item_outcome_v1(uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';

