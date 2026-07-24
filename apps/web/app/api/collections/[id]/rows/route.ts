// apps/web/app/api/collections/[id]/rows/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get("limit") ?? "100")
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { data } = await supabase
    .from("collection_rows")
    .select("*")
    .eq("collection_id", id)
    .eq("owner_type", "user")
    .eq("owner_id", user.id)
    .limit(limit)
  return NextResponse.json(data ?? [])
}
