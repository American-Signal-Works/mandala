import { NextResponse } from "next/server"
import { companiesResponseSchema } from "@workspace/control-plane"
import { z } from "zod"
import { listAccessibleCompanies } from "@/lib/mandala/control-plane/queries"
import {
  CompanyInvitationError,
  issueCompanyInvitation,
} from "@/lib/mandala/invitations"
import { createWorkspaceWithOwner } from "@/lib/mandala/workspace-service"
import { authenticateRequest } from "@/lib/supabase/request"

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  initialInvitations: z
    .array(z.string().trim().email().max(320))
    .max(200)
    .optional()
    .default([]),
})

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

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }
  const parsed = createWorkspaceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }
  const recipients = parsed.data.initialInvitations.map((email) =>
    email.toLocaleLowerCase("en-US")
  )
  if (new Set(recipients).size !== recipients.length) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const workspace = await createWorkspaceWithOwner(
      auth.supabase,
      parsed.data.name
    )
    const invitations = await Promise.all(
      recipients.map(async (recipientEmail) => {
        try {
          const invitation = await issueCompanyInvitation({
            supabase: auth.supabase,
            companyId: workspace.id,
            recipientEmail,
          })
          return { recipientEmail, status: "issued" as const, invitation }
        } catch (error) {
          return {
            recipientEmail,
            status: "failed" as const,
            error:
              error instanceof CompanyInvitationError
                ? error.code
                : "invitation_failed",
          }
        }
      })
    )
    return NextResponse.json(
      { workspace, invitations },
      { status: 201, headers: { "cache-control": "private, no-store" } }
    )
  } catch {
    return NextResponse.json(
      { error: "workspace_creation_failed" },
      { status: 500 }
    )
  }
}
