import { z } from "zod"
import {
  FeedbackRepositoryError,
  SupabaseFeedbackRepository,
  captureRecommendationFeedback,
} from "@/lib/mandala/feedback"
import {
  MemoryProviderError,
  SupabasePostgresMemoryProvider,
} from "@/lib/mandala/memory"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { feedbackJson, parseFeedbackJson } from "./http"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return feedbackJson({ error: "unauthorized" }, 401)
  const body = await parseFeedbackJson(request)
  const companyId = companyIdSchema.safeParse(
    typeof body === "object" && body !== null && "companyId" in body
      ? body.companyId
      : null
  )
  if (!companyId.success) return feedbackJson({ error: "invalid_request" }, 400)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: companyId.data,
      userId: auth.user.id,
    })
    if (
      !membership ||
      !new Set(["owner", "admin", "approver", "member"]).has(membership.role)
    )
      return feedbackJson({ error: "forbidden" }, 403)
    const scopedUserId = memorySuggestionUserId(body)
    if (
      scopedUserId &&
      scopedUserId !== auth.user.id &&
      !new Set(["owner", "admin"]).has(membership.role)
    )
      return feedbackJson({ error: "forbidden" }, 403)

    const result = await captureRecommendationFeedback({
      repository: new SupabaseFeedbackRepository(auth.supabase),
      memoryProvider: new SupabasePostgresMemoryProvider(auth.supabase),
      actorId: auth.user.id,
      request: body,
    })
    return feedbackJson(result)
  } catch (error) {
    return feedbackError(error)
  }
}

const companyIdSchema = z.string().uuid()

function memorySuggestionUserId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null
  const suggestion = Reflect.get(body, "memorySuggestion")
  if (typeof suggestion !== "object" || suggestion === null) return null
  const applicability = Reflect.get(suggestion, "applicability")
  if (typeof applicability !== "object" || applicability === null) return null
  const userId = Reflect.get(applicability, "userId")
  return typeof userId === "string" ? userId : null
}

function feedbackError(error: unknown) {
  if (error instanceof z.ZodError)
    return feedbackJson(
      { error: "invalid_request", issues: error.flatten().fieldErrors },
      400
    )
  if (error instanceof FeedbackRepositoryError) {
    const statuses = {
      recommendation_not_found: 404,
      recommendation_version_mismatch: 409,
      source_item_mismatch: 404,
      feedback_conflict: 409,
      repository_unavailable: 503,
      repository_invalid_response: 502,
    } as const
    return feedbackJson({ error: error.code }, statuses[error.code])
  }
  if (error instanceof MemoryProviderError) {
    const status =
      error.code === "provider_unavailable" ||
      error.code === "provider_invalid_response"
        ? 503
        : 409
    return feedbackJson({ error: error.code }, status)
  }
  return feedbackJson({ error: "feedback_capture_failed" }, 500)
}
