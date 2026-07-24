// apps/web/actions/views.ts
"use server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/lib/supabase/types"

const SortSchema = z.array(
  z.object({ fieldId: z.string(), direction: z.enum(["asc", "desc"]) })
)
const FilterSchema = z.array(
  z.object({
    fieldId: z.string(),
    operator: z.enum([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "contains",
      "starts_with",
      "is_empty",
      "is_not_empty",
      "in",
      "not_in",
    ]),
    value: z.unknown().optional(),
  })
)
const VisibleFieldsSchema = z.array(z.string())

const UpdateViewSchema = z.object({
  viewId: z.string().uuid(),
  config: z.object({
    sort: SortSchema.optional(),
    filters: FilterSchema.optional(),
    visibleFields: VisibleFieldsSchema.optional(),
  }),
})

export async function updateView(input: z.infer<typeof UpdateViewSchema>) {
  const parsed = UpdateViewSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false as const,
      error: {
        code: "INVALID_INPUT",
        message: parsed.error.issues[0]!.message,
      },
    }
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return {
      ok: false as const,
      error: { code: "UNAUTHENTICATED", message: "Sign in." },
    }

  const { data: view } = await supabase
    .from("collection_views")
    .select("config")
    .eq("id", parsed.data.viewId)
    .single()
  const newConfig = {
    ...(view?.config as object),
    ...parsed.data.config,
  } as Json

  const { error } = await supabase
    .from("collection_views")
    .update({ config: newConfig })
    .eq("id", parsed.data.viewId)
  if (error)
    return {
      ok: false as const,
      error: { code: "UPDATE_FAILED", message: error.message },
    }
  revalidatePath("/c/[pageId]", "page")
  return { ok: true as const, data: {} }
}
