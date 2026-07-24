// apps/web/app/api/collections/[id]/rows/[rowId]/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const { id, rowId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data } = await supabase
    .from("collection_rows")
    .select("*")
    .eq("id", rowId)
    .eq("collection_id", id)
    .eq("owner_type", "user")
    .eq("owner_id", user.id)
    .maybeSingle()
  return NextResponse.json(data)
}
