import { NextResponse } from "next/server"
import {
  cliSessionListResponseSchema,
  cliSessionRevocationRequestSchema,
  cliSessionRevocationResponseSchema,
} from "@workspace/control-plane"

import {
  loadCliSessions,
  revokeAllCliSessions,
  revokeCliSession,
} from "@/actions/admin/cli-auth"
import { privateCliAuthHeaders } from "@/lib/mandala/cli-auth"
import { listAccessibleCompanies } from "@/lib/mandala/control-plane/queries"
import { authenticateRequest } from "@/lib/supabase/request"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return privateError("unauthorized", 401)

  const { data, error } = await loadCliSessions(auth.user.id)
  if (error) return privateError("session_list_failed", 500)

  const isManagedCli = auth.cliSession?.managed === true
  const visibleSessions = isManagedCli
    ? data.filter((session) => session.id === auth.cliSession?.sessionId)
    : data

  const companyNameById = new Map<string, string>()
  if (!isManagedCli) {
    try {
      const companies = await listAccessibleCompanies({
        supabase: auth.supabase,
        userId: auth.user.id,
      })
      for (const company of companies) {
        companyNameById.set(company.id, company.name)
      }
    } catch {
      return privateError("session_list_failed", 500)
    }
  }

  const response = cliSessionListResponseSchema.safeParse({
    sessions: visibleSessions.map((session) => ({
      id: session.id,
      selectedCompanyId: session.selected_company_id,
      ...(isManagedCli
        ? {}
        : {
            selectedCompanyName: session.selected_company_id
              ? (companyNameById.get(session.selected_company_id) ?? null)
              : null,
          }),
      scopes: session.scopes,
      clientName: session.client_name,
      clientVersion: session.client_version,
      clientPlatform: session.client_platform,
      createdAt: session.created_at,
      lastUsedAt: session.last_used_at,
      revokedAt: session.revoked_at,
    })),
  })
  if (!response.success) return privateError("session_list_failed", 500)
  return NextResponse.json(response.data, { headers: privateCliAuthHeaders })
}

export async function DELETE(request: Request) {
  const auth = await authenticateRequest(request, { allowManagedCli: true })
  if (!auth) return privateError("unauthorized", 401)

  const parsed = cliSessionRevocationRequestSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) return privateError("invalid_request", 400)

  if (
    auth.cliSession?.managed === true &&
    ("all" in parsed.data ||
      parsed.data.sessionId !== auth.cliSession.sessionId)
  ) {
    return privateError("forbidden", 403)
  }

  const result =
    "all" in parsed.data
      ? await revokeAllCliSessions({ p_actor_user_id: auth.user.id })
      : await revokeCliSession({
          p_actor_user_id: auth.user.id,
          p_cli_session_id: parsed.data.sessionId,
        })
  if (result.error) {
    const status = result.error.message.includes("cli_session_not_found")
      ? 404
      : 500
    return privateError(
      status === 404 ? "session_not_found" : "session_revoke_failed",
      status
    )
  }

  const response = cliSessionRevocationResponseSchema.safeParse(result.data)
  if (!response.success) return privateError("session_revoke_failed", 500)
  return NextResponse.json(response.data, { headers: privateCliAuthHeaders })
}

function privateError(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: privateCliAuthHeaders }
  )
}
