#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

project_id="$(sed -nE 's/^project_id[[:space:]]*=[[:space:]]*"([^"]+)"/\1/p' supabase/config.toml | head -n 1)"
db_container="supabase_db_${project_id}"
fixture_test="supabase/tests/cycle_0_0_4_inbox_review_test.sql"
first_output="$(mktemp)"
second_output="$(mktemp)"

cleanup() {
  rm -f "$first_output" "$second_output"
  supabase db reset --local --no-seed >/dev/null
}
trap cleanup EXIT

docker inspect "$db_container" >/dev/null
supabase db reset --local --no-seed >/dev/null

awk '
  /^INSERT INTO auth\.users/ { copying = 1 }
  /^SELECT ok\(has_function_privilege/ { copying = 0 }
  copying { print }
' "$fixture_test" | docker exec -i "$db_container" \
  psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q

actor_id="91000000-0000-4000-8000-000000000001"
company_id="92000000-0000-4000-8000-000000000001"
item_id="96000000-0000-4000-8000-000000000001"
draft_id="9a000000-0000-4000-8000-000000000001"

session_prefix="SELECT set_config('request.jwt.claim.sub','$actor_id',false); SELECT set_config('request.jwt.claims','{\"sub\":\"$actor_id\",\"role\":\"authenticated\"}',false); SET ROLE authenticated;"
version="$(docker exec "$db_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atq -c "$session_prefix SELECT public.get_workflow_review_v1('$company_id','$item_id')->>'version';" | tail -n 1)"

first_sql="$session_prefix SELECT public.record_workflow_decision_v2(p_company_id=>'$company_id',p_workflow_item_id=>'$item_id',p_decision=>'reject',p_expected_version=>'$version',p_idempotency_key=>'concurrency-key-one',p_action_draft_id=>'$draft_id',p_reason=>'Concurrent decision test',p_warnings_acknowledged=>false,p_edited_payload=>NULL);"
second_sql="$session_prefix SELECT public.record_workflow_decision_v2(p_company_id=>'$company_id',p_workflow_item_id=>'$item_id',p_decision=>'reject',p_expected_version=>'$version',p_idempotency_key=>'concurrency-key-two',p_action_draft_id=>'$draft_id',p_reason=>'Concurrent decision test',p_warnings_acknowledged=>false,p_edited_payload=>NULL);"

set +e
docker exec "$db_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atq -c "$first_sql" >"$first_output" 2>&1 &
first_pid=$!
docker exec "$db_container" psql -v ON_ERROR_STOP=1 -U postgres -d postgres -Atq -c "$second_sql" >"$second_output" 2>&1 &
second_pid=$!
wait "$first_pid"
first_status=$?
wait "$second_pid"
second_status=$?
set -e

successes=0
[[ "$first_status" -eq 0 ]] && successes=$((successes + 1))
[[ "$second_status" -eq 0 ]] && successes=$((successes + 1))
if [[ "$successes" -ne 1 ]]; then
  echo "Expected exactly one successful concurrent decision; got $successes." >&2
  exit 1
fi

failed_output="$first_output"
[[ "$first_status" -eq 0 ]] && failed_output="$second_output"
if ! grep -Eq 'stale_version|invalid_state' "$failed_output"; then
  echo "The losing concurrent decision did not return a safe conflict." >&2
  exit 1
fi

decision_count="$(docker exec "$db_container" psql -U postgres -d postgres -Atq -c "SELECT count(*) FROM public.workflow_decisions WHERE workflow_item_id='$item_id';")"
activity_count="$(docker exec "$db_container" psql -U postgres -d postgres -Atq -c "SELECT count(*) FROM public.workflow_audit_events WHERE workflow_item_id='$item_id' AND event_type='decision_recorded';")"
if [[ "$decision_count" != "1" || "$activity_count" != "1" ]]; then
  echo "Concurrent decision created decision=$decision_count activity=$activity_count; expected 1/1." >&2
  exit 1
fi

echo "Cycle 0.0.4 concurrent decision test passed."
