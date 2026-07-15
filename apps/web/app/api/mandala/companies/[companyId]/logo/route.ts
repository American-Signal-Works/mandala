import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import {
  ImageUploadError,
  processFirstPartyImage,
} from "@/lib/media/image-upload"
import {
  getWorkspaceIdentity,
  updateWorkspaceIdentity,
  WorkspaceServiceError,
} from "@/lib/mandala/workspace-service"
import { authenticateRequest } from "@/lib/supabase/request"

const paramsSchema = z.object({ companyId: z.string().uuid() })
const versionSchema = z.coerce.number().int().positive()
const deleteSchema = z.object({ expectedVersion: z.number().int().positive() })

type Context = { params: Promise<{ companyId: string }> }

export const runtime = "nodejs"

export async function POST(request: Request, context: Context) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const parsedParams = paramsSchema.safeParse(await context.params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: "company_not_found" }, { status: 404 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }
  const file = formData.get("file")
  const expectedVersion = versionSchema.safeParse(
    formData.get("expectedVersion")
  )
  if (!(file instanceof File) || !expectedVersion.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  try {
    const [current, image] = await Promise.all([
      getWorkspaceIdentity(auth.supabase, parsedParams.data.companyId),
      processFirstPartyImage(file, "workspace-logo"),
    ])
    const path = `${parsedParams.data.companyId}/${randomUUID()}.${image.extension}`
    const { error: uploadError } = await auth.supabase.storage
      .from("workspace-logos")
      .upload(path, image.bytes, {
        cacheControl: "31536000",
        contentType: image.contentType,
        upsert: false,
      })
    if (uploadError) {
      return NextResponse.json(
        { error: "workspace_logo_upload_failed" },
        { status: 503 }
      )
    }

    try {
      const workspace = await updateWorkspaceIdentity(auth.supabase, {
        companyId: parsedParams.data.companyId,
        name: current.name,
        logoPath: path,
        expectedVersion: expectedVersion.data,
      })
      if (workspace.previousLogoPath && workspace.previousLogoPath !== path) {
        await auth.supabase.storage
          .from("workspace-logos")
          .remove([workspace.previousLogoPath])
      }
      return NextResponse.json(
        { workspace },
        { headers: { "cache-control": "private, no-store" } }
      )
    } catch (error) {
      await auth.supabase.storage.from("workspace-logos").remove([path])
      throw error
    }
  } catch (error) {
    return workspaceLogoErrorResponse(error)
  }
}

export async function DELETE(request: Request, context: Context) {
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
  const parsed = deleteSchema.safeParse(body)
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
      name: current.name,
      logoPath: null,
      expectedVersion: parsed.data.expectedVersion,
    })
    if (workspace.previousLogoPath) {
      await auth.supabase.storage
        .from("workspace-logos")
        .remove([workspace.previousLogoPath])
    }
    return NextResponse.json(
      { workspace },
      { headers: { "cache-control": "private, no-store" } }
    )
  } catch (error) {
    return workspaceLogoErrorResponse(error)
  }
}

function workspaceLogoErrorResponse(error: unknown) {
  if (error instanceof ImageUploadError) {
    return NextResponse.json({ error: error.code }, { status: 400 })
  }
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
    { error: "workspace_logo_update_failed" },
    { status: 500 }
  )
}
