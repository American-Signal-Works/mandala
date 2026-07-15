import { NextResponse } from "next/server"
import { z } from "zod"
import {
  getWorkspaceIdentity,
  updateWorkspaceIdentity,
  WorkspaceServiceError,
} from "@/lib/mandala/workspace-service"
import { authenticateRequest } from "@/lib/supabase/request"

const paramsSchema = z.object({ companyId: z.string().uuid() })
const updateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  expectedVersion: z.number().int().positive(),
})

type Context = { params: Promise<{ companyId: string }> }

export async function GET(request: Request, context: Context) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const parsedParams = paramsSchema.safeParse(await context.params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 })
  }

  try {
    const workspace = await getWorkspaceIdentity(
      auth.supabase,
      parsedParams.data.companyId
    )
    return NextResponse.json(
      { workspace },
      { headers: { "cache-control": "private, no-store" } }
    )
  } catch {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 })
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const parsedParams = paramsSchema.safeParse(await context.params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const current = await getWorkspaceIdentity(
      auth.supabase,
      parsedParams.data.companyId
    )
    const workspace = await updateWorkspaceIdentity(auth.supabase, {
      companyId: parsedParams.data.companyId,
      name: parsed.data.name,
      logoPath: current.logoPath,
      expectedVersion: parsed.data.expectedVersion,
    })
    return NextResponse.json(
      { workspace },
      { headers: { "cache-control": "private, no-store" } }
    )
  } catch (error) {
    return workspaceErrorResponse(error)
  }
}

function workspaceErrorResponse(error: unknown) {
  if (
    error instanceof WorkspaceServiceError &&
    error.code === "company_version_conflict"
  ) {
    return NextResponse.json({ error: error.code }, { status: 409 })
  }
  if (
    error instanceof WorkspaceServiceError &&
    error.code === "company_not_found"
  ) {
    return NextResponse.json({ error: error.code }, { status: 404 })
  }
  return NextResponse.json(
    { error: "workspace_update_failed" },
    { status: 500 }
  )
}
