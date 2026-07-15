import { z } from "zod"
import {
  SupabasePostgresMemoryProvider,
  exportGovernedMemory,
} from "@/lib/mandala/memory"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import { authenticateRequest } from "@/lib/supabase/request"
import { memoryError, memoryJson } from "../http"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) return memoryJson({ error: "unauthorized" }, 401)
  const companyId = z
    .string()
    .uuid()
    .safeParse(new URL(request.url).searchParams.get("companyId"))
  if (!companyId.success) return memoryJson({ error: "invalid_request" }, 400)

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: companyId.data,
      userId: auth.user.id,
    })
    if (!membership || !new Set(["owner", "admin"]).has(membership.role))
      return memoryJson({ error: "forbidden" }, 403)
    return memoryJson(
      await exportGovernedMemory({
        provider: new SupabasePostgresMemoryProvider(auth.supabase),
        companyId: companyId.data,
      })
    )
  } catch (error) {
    return memoryError(error, "memory_export_failed")
  }
}
