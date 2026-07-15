import { NextResponse } from "next/server"
import { getCompanyMembership } from "@/lib/mandala/workflows"
import {
  getCompanyUsageSummary,
  usageSummaryRequestSchema,
} from "@/lib/mandala/usage"
import { authenticateRequest } from "@/lib/supabase/request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const privateHeaders = {
  "cache-control": "private, no-store",
  vary: "cookie, authorization",
}

export async function GET(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: privateHeaders }
    )
  }

  const url = new URL(request.url)
  const parsed = usageSummaryRequestSchema.safeParse({
    companyId: url.searchParams.get("companyId"),
    periodStart: url.searchParams.get("periodStart"),
    periodEnd: url.searchParams.get("periodEnd"),
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400, headers: privateHeaders }
    )
  }

  try {
    const membership = await getCompanyMembership({
      supabase: auth.supabase,
      companyId: parsed.data.companyId,
      userId: auth.user.id,
    })
    if (!membership) {
      return NextResponse.json(
        { error: "forbidden" },
        { status: 403, headers: privateHeaders }
      )
    }

    return NextResponse.json(
      await getCompanyUsageSummary({
        supabase: auth.supabase,
        ...parsed.data,
      }),
      { headers: privateHeaders }
    )
  } catch {
    return NextResponse.json(
      { error: "usage_summary_failed" },
      { status: 500, headers: privateHeaders }
    )
  }
}
