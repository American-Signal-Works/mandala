// apps/web/actions/templates.ts
"use server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { templates } from "@/lib/templates"
import type { Json } from "@/lib/supabase/types"

const Result = <T>(data: T) => ({ ok: true as const, data })
const Err = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
})

const ApplyTemplateSchema = z.object({ templateId: z.string() })

export async function applyTemplate(
  input: z.infer<typeof ApplyTemplateSchema>
) {
  const parsed = ApplyTemplateSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Err("UNAUTHENTICATED", "Sign in.")

  const tpl = templates.find((t) => t.id === parsed.data.templateId)
  if (!tpl) return Err("UNKNOWN_TEMPLATE", "Template not found.")

  if (tpl.pageType !== "dashboard")
    return Err("NOT_IMPLEMENTED", "Only dashboard templates supported in v1.")

  // Resolve required collections; build the substitution map for placeholders.
  const subs: Record<string, string> = {}
  for (const req of tpl.requiresCollections) {
    const { data } = await supabase
      .from("collections")
      .select("id, name")
      .eq("owner_type", "user")
      .eq("owner_id", user.id)
      .eq("managed_by_connection", req.managed_by_connection)
      .eq("name", req.name)
      .is("deleted_at", null)
      .maybeSingle()

    if (!data)
      return Err(
        "MISSING_COLLECTION",
        `This template needs the ${req.name} collection — import data first.`
      )
    subs[`__${req.name.toUpperCase()}__`] = data.id

    // Resolve standard field placeholders for trading templates
    if (req.name === "Trades") {
      const { data: fields } = await supabase
        .from("collection_fields")
        .select("id, name")
        .eq("collection_id", data.id)
      const byName = (n: string) => fields?.find((f) => f.name === n)?.id ?? ""
      subs["__TRADES__"] = data.id
      subs["__TRADES_NETPNL__"] = byName("Net P&L")
      subs["__TRADES_SYMBOL__"] = byName("Symbol")
      subs["__TRADES_CLOSEDAT__"] = byName("Closed at")
    }
  }

  const document = substitutePlaceholders(tpl.document, subs)

  const { data: lastPage } = await supabase
    .from("pages")
    .select("sort_index")
    .eq("owner_type", "user")
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .order("sort_index", { ascending: false })
    .limit(1)
    .maybeSingle()
  const sort_index = (lastPage?.sort_index ?? 0) + 1000

  const { data: page, error } = await supabase
    .from("pages")
    .insert({
      owner_type: "user",
      owner_id: user.id,
      title: tpl.name,
      emoji: tpl.emoji ?? null,
      page_type: "dashboard",
      document: document as Json,
      sort_index,
    })
    .select("id")
    .single()
  if (error) return Err("CREATE_FAILED", error.message)

  revalidatePath("/", "layout")
  return Result({ id: page.id })
}

function substitutePlaceholders(
  value: unknown,
  subs: Record<string, string>
): unknown {
  if (typeof value === "string") {
    return subs[value] ?? value
  }
  if (Array.isArray(value)) {
    return value.map((v) => substitutePlaceholders(v, subs))
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substitutePlaceholders(v, subs)
    }
    return out
  }
  return value
}
