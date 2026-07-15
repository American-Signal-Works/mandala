// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"
import { processFirstPartyImage } from "@/lib/media/image-upload"
import {
  getMyProfileIdentity,
  ProfileServiceError,
  updateMyProfileIdentity,
} from "@/lib/profile/service"
import { authenticateRequest } from "@/lib/supabase/request"
import { POST } from "./route"

vi.mock("@/lib/supabase/request", () => ({ authenticateRequest: vi.fn() }))
vi.mock("@/lib/media/image-upload", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/media/image-upload")>()
  return { ...original, processFirstPartyImage: vi.fn() }
})
vi.mock("@/lib/profile/service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/profile/service")>()
  return {
    ...original,
    getMyProfileIdentity: vi.fn(),
    updateMyProfileIdentity: vi.fn(),
  }
})

const userId = "10000000-0000-4000-8000-000000000001"

function request() {
  const formData = new FormData()
  formData.set(
    "file",
    new File(["source"], "avatar.png", { type: "image/png" })
  )
  formData.set("expectedVersion", "4")
  return new Request("http://localhost/api/settings/profile/avatar", {
    method: "POST",
    headers: { origin: "http://localhost" },
    body: formData,
  })
}

describe("safe avatar route", () => {
  const upload = vi.fn().mockResolvedValue({ error: null })
  const remove = vi.fn().mockResolvedValue({ error: null })
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: "http://localhost/storage/signed/avatar" },
    error: null,
  })
  const supabase = {
    storage: {
      from: vi.fn(() => ({ upload, remove, createSignedUrl })),
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateRequest).mockResolvedValue({
      authMode: "cookie",
      supabase,
      user: { id: userId },
    } as never)
    vi.mocked(getMyProfileIdentity).mockResolvedValue({
      userId,
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      avatarPath: `${userId}/00000000-0000-4000-8000-000000000001.png`,
      timezone: "UTC",
      themeMode: "system",
      themeAccent: "default",
      version: 4,
      updatedAt: "2026-07-15T12:00:00.000Z",
    })
    vi.mocked(processFirstPartyImage).mockResolvedValue({
      bytes: Buffer.from("safe-image"),
      contentType: "image/png",
      extension: "png",
      width: 512,
      height: 512,
    })
    vi.mocked(updateMyProfileIdentity).mockResolvedValue({
      firstName: "Ada",
      lastName: "Lovelace",
      displayName: "Ada Lovelace",
      avatarPath: `${userId}/00000000-0000-4000-8000-000000000002.png`,
      timezone: "UTC",
      version: 5,
      updatedAt: "2026-07-15T12:01:00.000Z",
    })
  })

  it("uses the server decoder, stores only processed bytes, and returns a signed URL", async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(processFirstPartyImage).toHaveBeenCalledWith(
      expect.any(File),
      "avatar"
    )
    expect(upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${userId}/[0-9a-f-]{36}\\.png$`)),
      Buffer.from("safe-image"),
      expect.objectContaining({ contentType: "image/png", upsert: false })
    )
    expect(updateMyProfileIdentity).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({ expectedVersion: 4 })
    )
    await expect(response.json()).resolves.toMatchObject({
      signedUrl: "http://localhost/storage/signed/avatar",
      version: 5,
    })
  })

  it("removes a newly uploaded orphan when the profile version conflicts", async () => {
    vi.mocked(updateMyProfileIdentity).mockRejectedValue(
      new ProfileServiceError("profile_version_conflict")
    )

    const response = await POST(request())

    expect(response.status).toBe(409)
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(new RegExp(`^${userId}/[0-9a-f-]{36}\\.png$`)),
    ])
  })
})
