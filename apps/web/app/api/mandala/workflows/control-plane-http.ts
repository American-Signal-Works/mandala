import { NextResponse } from "next/server"
import { BoundCursorError } from "@/lib/mandala/control-plane/cursor"
import { ControlPlaneQueryError } from "@/lib/mandala/control-plane/queries"

export const privateNoStoreHeaders = { "cache-control": "private, no-store" }

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: privateNoStoreHeaders,
  })
}

export function controlPlaneErrorResponse(error: unknown, fallback: string) {
  if (error instanceof BoundCursorError) {
    return privateJson({ error: "invalid_cursor" }, 400)
  }
  if (!(error instanceof ControlPlaneQueryError)) {
    return privateJson({ error: fallback }, 500)
  }

  const statuses: Partial<Record<ControlPlaneQueryError["code"], number>> = {
    unauthorized: 401,
    forbidden: 403,
    item_not_found: 404,
    draft_not_found: 404,
    invalid_queue_query: 400,
    invalid_queue_cursor: 400,
    queue_query_too_broad: 400,
    invalid_review_request: 400,
    invalid_activity_request: 400,
    invalid_decision: 400,
    warnings_not_acknowledged: 400,
    edited_payload_invalid: 400,
    edit_reason_required: 400,
    edited_payload_shape_changed: 400,
    edited_payload_identity_changed: 400,
    edited_payload_value_invalid: 400,
    edited_payload_not_allowed: 400,
    idempotency_key_reused: 409,
    stale_draft: 409,
    stale_version: 409,
    invalid_state: 409,
    review_not_approvable: 409,
  }
  return privateJson({ error: error.code }, statuses[error.code] ?? 500)
}
