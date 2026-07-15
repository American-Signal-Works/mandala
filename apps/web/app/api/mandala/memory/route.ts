import { z } from "zod"
import {
  SupabasePostgresMemoryProvider,
  forgetGovernedMemory,
  retrieveGovernedMemory,
  reviewMemoryCandidate,
} from "@/lib/mandala/memory"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { memoryError, memoryJson, parseMemoryJson } from "./http"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return memoryJson({ error: "unauthorized" }, 401)
  const url = new URL(request.url)
  const query = {
    companyId: url.searchParams.get("companyId"),
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    agentId: url.searchParams.get("agentId") ?? undefined,
    itemId: url.searchParams.get("itemId") ?? undefined,
    vendorId: url.searchParams.get("vendorId") ?? undefined,
    productId: url.searchParams.get("productId") ?? undefined,
    userId: url.searchParams.get("userId") ?? undefined,
    maxResults: url.searchParams.get("maxResults") ?? undefined,
  }
  const companyId = z.string().uuid().safeParse(query.companyId)
  if (!companyId.success) return memoryJson({ error: "invalid_request" }, 400)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: companyId.data,
      userId: auth.user.id,
    })
    if (!membership) return memoryJson({ error: "forbidden" }, 403)
    if (
      query.userId &&
      query.userId !== auth.user.id &&
      !new Set(["owner", "admin"]).has(membership.role)
    )
      return memoryJson({ error: "forbidden" }, 403)
    return memoryJson(
      await retrieveGovernedMemory({
        provider: new SupabasePostgresMemoryProvider(auth.supabase),
        request: query,
      })
    )
  } catch (error) {
    return memoryError(error, "memory_retrieval_failed")
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return memoryJson({ error: "unauthorized" }, 401)
  const body = await parseMemoryJson(request)
  const companyId = z
    .string()
    .uuid()
    .safeParse(
      typeof body === "object" && body !== null && "companyId" in body
        ? body.companyId
        : null
    )
  if (!companyId.success) return memoryJson({ error: "invalid_request" }, 400)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: companyId.data,
      userId: auth.user.id,
    })
    if (!membership || !new Set(["owner", "admin"]).has(membership.role))
      return memoryJson({ error: "forbidden" }, 403)
    const candidate = await reviewMemoryCandidate({
      provider: new SupabasePostgresMemoryProvider(auth.supabase),
      actorId: auth.user.id,
      request: body,
    })
    return memoryJson({ candidate })
  } catch (error) {
    return memoryError(error, "memory_review_failed")
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return memoryJson({ error: "unauthorized" }, 401)
  const body = await parseMemoryJson(request)
  const companyId = z
    .string()
    .uuid()
    .safeParse(
      typeof body === "object" && body !== null && "companyId" in body
        ? body.companyId
        : null
    )
  if (!companyId.success) return memoryJson({ error: "invalid_request" }, 400)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: companyId.data,
      userId: auth.user.id,
    })
    if (!membership || !new Set(["owner", "admin"]).has(membership.role))
      return memoryJson({ error: "forbidden" }, 403)
    const receipt = await forgetGovernedMemory({
      provider: new SupabasePostgresMemoryProvider(auth.supabase),
      actorId: auth.user.id,
      request: body,
    })
    return memoryJson({ receipt })
  } catch (error) {
    return memoryError(error, "memory_forget_failed")
  }
}
