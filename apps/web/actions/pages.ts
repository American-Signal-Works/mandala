// apps/web/actions/pages.ts
"use server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"

const Result = <T>(data: T) => ({ ok: true as const, data })
const Err = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
})

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("UNAUTHENTICATED")
  return { supabase, user }
}

export async function listPages() {
  const { supabase, user } = await requireUser()
  const { data, error } = await supabase
    .from("pages")
    .select("id, title, emoji, page_type, sort_index, collection_id")
    .eq("owner_type", "user")
    .eq("owner_id", user.id)
    .is("deleted_at", null)
    .order("sort_index")
  if (error) return Err("LIST_FAILED", error.message)
  return Result(data ?? [])
}

const CreatePageSchema = z.object({
  pageType: z.enum(["dashboard", "collection"]),
  title: z.string().default("Untitled"),
  collectionName: z.string().optional(),
})

export async function createPage(input: z.infer<typeof CreatePageSchema>) {
  const parsed = CreatePageSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)

  const { supabase, user } = await requireUser()

  // Compute next sort_index
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

  if (parsed.data.pageType === "dashboard") {
    const { data, error } = await supabase
      .from("pages")
      .insert({
        owner_type: "user",
        owner_id: user.id,
        title: parsed.data.title,
        page_type: "dashboard",
        document: {
          type: "doc",
          children: [{ type: "p", children: [{ text: "" }] }],
        },
        sort_index,
      })
      .select("id")
      .single()
    if (error) return Err("CREATE_FAILED", error.message)
    revalidatePath("/", "layout")
    return Result({ id: data.id })
  }

  // collection page: create collection, then page, then default view
  const { data: collection, error: cErr } = await supabase
    .from("collections")
    .insert({
      owner_type: "user",
      owner_id: user.id,
      name: parsed.data.collectionName ?? parsed.data.title,
    })
    .select("id")
    .single()
  if (cErr) return Err("CREATE_FAILED", cErr.message)

  const { data: page, error: pErr } = await supabase
    .from("pages")
    .insert({
      owner_type: "user",
      owner_id: user.id,
      title: parsed.data.title,
      page_type: "collection",
      collection_id: collection.id,
      sort_index,
    })
    .select("id")
    .single()
  if (pErr) return Err("CREATE_FAILED", pErr.message)

  const { error: vErr } = await supabase.from("collection_views").insert({
    owner_type: "user",
    owner_id: user.id,
    collection_id: collection.id,
    name: "Default view",
    type: "list",
    config: { sort: [], filters: [], visibleFields: [] },
    is_default: true,
    sort_index: 0,
  })
  if (vErr) return Err("CREATE_FAILED", vErr.message)

  revalidatePath("/", "layout")
  return Result({ id: page.id, collection_id: collection.id })
}

const RenameSchema = z.object({
  pageId: z.string().uuid(),
  title: z.string().min(1),
})
export async function renamePage(input: z.infer<typeof RenameSchema>) {
  const parsed = RenameSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from("pages")
    .update({ title: parsed.data.title })
    .eq("id", parsed.data.pageId)
  if (error) return Err("RENAME_FAILED", error.message)
  revalidatePath("/", "layout")
  return Result({})
}

const EmojiSchema = z.object({
  pageId: z.string().uuid(),
  emoji: z.string().nullable(),
})
export async function changePageEmoji(input: z.infer<typeof EmojiSchema>) {
  const parsed = EmojiSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from("pages")
    .update({ emoji: parsed.data.emoji })
    .eq("id", parsed.data.pageId)
  if (error) return Err("UPDATE_FAILED", error.message)
  revalidatePath("/", "layout")
  return Result({})
}

const DeleteSchema = z.object({ pageId: z.string().uuid() })
export async function deletePage(input: z.infer<typeof DeleteSchema>) {
  const parsed = DeleteSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from("pages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.pageId)
  if (error) return Err("DELETE_FAILED", error.message)
  revalidatePath("/", "layout")
  return Result({})
}

const ReorderSchema = z.object({ pageIds: z.array(z.string().uuid()) })
export async function reorderPages(input: z.infer<typeof ReorderSchema>) {
  const parsed = ReorderSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase } = await requireUser()
  const updates = parsed.data.pageIds.map((id, idx) =>
    supabase
      .from("pages")
      .update({ sort_index: (idx + 1) * 1000 })
      .eq("id", id)
  )
  await Promise.all(updates)
  revalidatePath("/", "layout")
  return Result({})
}

const SaveDocSchema = z.object({
  pageId: z.string().uuid(),
  document: z.unknown(),
  expectedUpdatedAt: z.string(), // ISO from the client's last-known updated_at
})

export async function savePageDocument(input: z.infer<typeof SaveDocSchema>) {
  const parsed = SaveDocSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase } = await requireUser()

  // Read current updated_at; reject if it doesn't match
  const { data: existing } = await supabase
    .from("pages")
    .select("updated_at, page_type")
    .eq("id", parsed.data.pageId)
    .single()
  if (!existing) return Err("PAGE_NOT_FOUND", "Page not found")
  if (existing.page_type !== "dashboard")
    return Err("WRONG_PAGE_TYPE", "Document only valid on dashboards")
  if (existing.updated_at !== parsed.data.expectedUpdatedAt) {
    return Err(
      "STALE_DOCUMENT",
      "Page was updated elsewhere; refresh and merge."
    )
  }

  const { data, error } = await supabase
    .from("pages")
    .update({
      document: parsed.data
        .document as unknown as import("@/lib/supabase/types").Json,
    })
    .eq("id", parsed.data.pageId)
    .select("updated_at")
    .single()
  if (error) return Err("SAVE_FAILED", error.message)
  return Result({ updated_at: data.updated_at })
}
