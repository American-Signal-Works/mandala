import { NextResponse } from "next/server"
import { companiesResponseSchema } from "@workspace/control-plane"
import { listAccessibleCompanies } from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    const companies = await listAccessibleCompanies({
      supabase: auth.supabase,
      userId: auth.user.id,
    })
    return NextResponse.json(companiesResponseSchema.parse({ companies }), {
      headers: { "cache-control": "private, no-store" },
    })
  } catch {
    return NextResponse.json({ error: "company_list_failed" }, { status: 500 })
  }
}
