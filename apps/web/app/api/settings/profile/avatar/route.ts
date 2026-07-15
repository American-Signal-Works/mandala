import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import {
  ImageUploadError,
  processFirstPartyImage,
} from "@/lib/media/image-upload"
import {
  getMyProfileIdentity,
  ProfileServiceError,
  updateMyProfileIdentity,
} from "@/lib/profile/service"
import { authenticateRequest } from "@/lib/supabase/request"

const versionSchema = z.coerce.number().int().positive()

export const runtime = "nodejs"

export async function POST(request: Request) {
  const auth = await authenticateRequest(request)
  if (!auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
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
      getMyProfileIdentity(auth.supabase),
      processFirstPartyImage(file, "avatar"),
    ])
    if (!current.firstName || !current.lastName) {
      return NextResponse.json(
        { error: "profile_names_required" },
        { status: 409 }
      )
    }

    const path = `${auth.user.id}/${randomUUID()}.${image.extension}`
    const { error: uploadError } = await auth.supabase.storage
      .from("avatars")
      .upload(path, image.bytes, {
        cacheControl: "31536000",
        contentType: image.contentType,
        upsert: false,
      })
    if (uploadError) {
      return NextResponse.json(
        { error: "avatar_upload_failed" },
        { status: 503 }
      )
    }

    const { data: signed, error: signedUrlError } = await auth.supabase.storage
      .from("avatars")
      .createSignedUrl(path, 60 * 60)
    if (signedUrlError || !signed?.signedUrl) {
      await auth.supabase.storage.from("avatars").remove([path])
      return NextResponse.json({ error: "avatar_url_failed" }, { status: 503 })
    }

    try {
      const updated = await updateMyProfileIdentity(auth.supabase, {
        firstName: current.firstName,
        lastName: current.lastName,
        displayName: current.displayName,
        timezone: current.timezone,
        avatarPath: path,
        expectedVersion: expectedVersion.data,
      })

      if (current.avatarPath && current.avatarPath !== path) {
        await auth.supabase.storage.from("avatars").remove([current.avatarPath])
      }

      return NextResponse.json(
        {
          avatarPath: path,
          signedUrl: signed.signedUrl,
          version: updated.version,
        },
        { headers: { "cache-control": "private, no-store" } }
      )
    } catch (error) {
      await auth.supabase.storage.from("avatars").remove([path])
      throw error
    }
  } catch (error) {
    if (error instanceof ImageUploadError) {
      return NextResponse.json({ error: error.code }, { status: 400 })
    }
    if (
      error instanceof ProfileServiceError &&
      error.code === "profile_version_conflict"
    ) {
      return NextResponse.json({ error: error.code }, { status: 409 })
    }
    return NextResponse.json({ error: "avatar_update_failed" }, { status: 500 })
  }
}
