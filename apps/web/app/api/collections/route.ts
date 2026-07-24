// apps/web/app/api/collections/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data: collections } = await supabase
    .from("collections")
    .select("id, name")
    .eq("owner_type", "user")
    .eq("owner_id", user.id)
    .is("deleted_at", null)
  if (!collections) return NextResponse.json([])

  const ids = collections.map((c) => c.id)
  const { data: fields } = await supabase
    .from("collection_fields")
    .select("id, name, type, collection_id")
    .in("collection_id", ids)

  const result = collections.map((c) => ({
    id: c.id,
    name: c.name,
    fields: (fields ?? []).filter((f) => f.collection_id === c.id),
  }))
  return NextResponse.json(result)
}
