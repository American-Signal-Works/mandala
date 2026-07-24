// apps/web/actions/collections.ts
"use server"
import { revalidatePath } from "next/cache"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { defaultValueFor, normalizeValue } from "@/lib/collections/fields"
import type { Field } from "@/lib/collections/types"
import type { Json } from "@/lib/supabase/types"

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

const FieldTypeEnum = z.enum([
  "text",
  "number",
  "currency",
  "date",
  "datetime",
  "select",
  "multi_select",
  "checkbox",
])

const AddFieldSchema = z.object({
  collectionId: z.string().uuid(),
  name: z.string().min(1),
  type: FieldTypeEnum,
  options: z
    .array(
      z.object({
        value: z.string(),
        label: z.string(),
        color: z.string().optional(),
      })
    )
    .default([]),
  config: z.record(z.unknown()).default({}),
})

export async function addField(input: z.infer<typeof AddFieldSchema>) {
  const parsed = AddFieldSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase, user } = await requireUser()

  const { data: lastField } = await supabase
    .from("collection_fields")
    .select("sort_index")
    .eq("collection_id", parsed.data.collectionId)
    .order("sort_index", { ascending: false })
    .limit(1)
    .maybeSingle()
  const sort_index = (lastField?.sort_index ?? 0) + 1000

  const { data, error } = await supabase
    .from("collection_fields")
    .insert({
      owner_type: "user",
      owner_id: user.id,
      collection_id: parsed.data.collectionId,
      name: parsed.data.name,
      type: parsed.data.type,
      options: parsed.data.options as Json,
      config: parsed.data.config as Json,
      sort_index,
    })
    .select("id")
    .single()
  if (error) return Err("ADD_FIELD_FAILED", error.message)
  revalidatePath("/c/[pageId]", "page")
  return Result({ id: data.id })
}

const RenameFieldSchema = z.object({
  fieldId: z.string().uuid(),
  name: z.string().min(1),
})
export async function renameField(input: z.infer<typeof RenameFieldSchema>) {
  const parsed = RenameFieldSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase } = await requireUser()

  const { data: field } = await supabase
    .from("collection_fields")
    .select("is_system")
    .eq("id", parsed.data.fieldId)
    .single()
  if (field?.is_system)
    return Err("SYSTEM_FIELD", "System fields can't be renamed.")

  const { error } = await supabase
    .from("collection_fields")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.fieldId)
  if (error) return Err("RENAME_FAILED", error.message)
  revalidatePath("/c/[pageId]", "page")
  return Result({})
}

const DeleteFieldSchema = z.object({ fieldId: z.string().uuid() })
export async function deleteField(input: z.infer<typeof DeleteFieldSchema>) {
  const parsed = DeleteFieldSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase } = await requireUser()

  const { data: field } = await supabase
    .from("collection_fields")
    .select("is_system")
    .eq("id", parsed.data.fieldId)
    .single()
  if (field?.is_system)
    return Err("SYSTEM_FIELD", "System fields can't be deleted.")

  const { error } = await supabase
    .from("collection_fields")
    .delete()
    .eq("id", parsed.data.fieldId)
  if (error) return Err("DELETE_FAILED", error.message)
  revalidatePath("/c/[pageId]", "page")
  return Result({})
}

const AddRowSchema = z.object({
  collectionId: z.string().uuid(),
  data: z.record(z.unknown()).default({}),
})
export async function addRow(input: z.infer<typeof AddRowSchema>) {
  const parsed = AddRowSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase, user } = await requireUser()

  const { data: fields } = await supabase
    .from("collection_fields")
    .select("*")
    .eq("collection_id", parsed.data.collectionId)
  const initial: Record<string, unknown> = {}
  ;(fields ?? []).forEach((f) => {
    initial[f.id] = defaultValueFor(f as unknown as Field)
  })
  Object.assign(initial, parsed.data.data)

  const { data, error } = await supabase
    .from("collection_rows")
    .insert({
      owner_type: "user",
      owner_id: user.id,
      collection_id: parsed.data.collectionId,
      data: initial as Json,
      source: "user",
    })
    .select("id")
    .single()
  if (error) return Err("ADD_ROW_FAILED", error.message)
  revalidatePath("/c/[pageId]", "page")
  return Result({ id: data.id })
}

const UpdateRowFieldSchema = z.object({
  rowId: z.string().uuid(),
  fieldId: z.string().uuid(),
  value: z.unknown(),
})
export async function updateRowField(
  input: z.infer<typeof UpdateRowFieldSchema>
) {
  const parsed = UpdateRowFieldSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase } = await requireUser()

  const { data: field } = (await supabase
    .from("collection_fields")
    .select("type")
    .eq("id", parsed.data.fieldId)
    .single()) as { data: Pick<Field, "type"> | null }
  if (!field) return Err("FIELD_NOT_FOUND", "Field doesn't exist.")

  let normalized
  try {
    normalized = normalizeValue(field, parsed.data.value)
  } catch (e) {
    return Err("INVALID_VALUE", (e as Error).message)
  }

  const { data: row } = await supabase
    .from("collection_rows")
    .select("data")
    .eq("id", parsed.data.rowId)
    .single()
  if (!row) return Err("ROW_NOT_FOUND", "Row doesn't exist.")
  const newData = {
    ...(row.data as Record<string, unknown>),
    [parsed.data.fieldId]: normalized,
  } as Json

  const { error } = await supabase
    .from("collection_rows")
    .update({ data: newData })
    .eq("id", parsed.data.rowId)
  if (error) return Err("UPDATE_FAILED", error.message)
  revalidatePath("/c/[pageId]", "page")
  return Result({})
}

const DeleteRowSchema = z.object({ rowId: z.string().uuid() })
export async function deleteRow(input: z.infer<typeof DeleteRowSchema>) {
  const parsed = DeleteRowSchema.safeParse(input)
  if (!parsed.success)
    return Err("INVALID_INPUT", parsed.error.issues[0]!.message)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from("collection_rows")
    .delete()
    .eq("id", parsed.data.rowId)
  if (error) return Err("DELETE_FAILED", error.message)
  revalidatePath("/c/[pageId]", "page")
  return Result({})
}
