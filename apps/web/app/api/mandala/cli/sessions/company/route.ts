import { NextResponse } from "next/server"
import {
  cliSessionCompanySelectionRequestSchema,
  cliSessionCompanySelectionResponseSchema,
} from "@workspace/control-plane"

import { selectCliSessionCompany } from "@/actions/admin/cli-auth"
import { privateCliAuthHeaders } from "@/lib/mandala/cli-auth"
import { listAccessibleCompanies } from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PUT(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth || auth.authMode !== "bearer") {
    return privateResponse({ error: "unauthorized" }, 401)
  }

  const parsed = cliSessionCompanySelectionRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return privateResponse({ error: "invalid_request" }, 400)
  }

  if (auth.cliSession?.managed !== true) {
    try {
      const companies = await listAccessibleCompanies({
        supabase: auth.supabase,
        userId: auth.user.id,
      })
      const company = companies.find(
        (candidate) => candidate.id === parsed.data.companyId
      )
      if (!company)
        return privateResponse({ error: "company_not_accessible" }, 403)
      return privateResponse(
        cliSessionCompanySelectionResponseSchema.parse({
          company: {
            id: company.id,
            name: company.name,
            role: company.role,
          },
        })
      )
    } catch {
      return privateResponse({ error: "company_selection_failed" }, 500)
    }
  }

  if (!auth.cliSession.sessionId)
    return privateResponse({ error: "unauthorized" }, 401)

  const { data, error } = await selectCliSessionCompany({
    p_actor_user_id: auth.user.id,
    p_cli_session_id: auth.cliSession.sessionId,
    p_company_id: parsed.data.companyId,
  })
  if (error) return privateResponse({ error: "company_selection_failed" }, 500)

  const selected = cliSessionCompanySelectionResponseSchema.safeParse(data)
  if (!selected.success) {
    const code =
      data && typeof data === "object" && "error" in data ? data.error : null
    return privateResponse(
      {
        error:
          code === "forbidden"
            ? "company_not_accessible"
            : "company_selection_failed",
      },
      code === "forbidden" ? 403 : 500
    )
  }

  return privateResponse(selected.data)
}

function privateResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateCliAuthHeaders })
}
