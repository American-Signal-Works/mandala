// apps/web/app/api/collections/[id]/fields/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data } = await supabase
    .from("collection_fields")
    .select("*")
    .eq("collection_id", id)
    .eq("owner_type", "user")
    .eq("owner_id", user.id)
    .order("sort_index")
  return NextResponse.json(data ?? [])
}
