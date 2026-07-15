// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  getMyProfileIdentity,
  ProfileServiceError,
  updateMyProfileIdentity,
  updateMyProfilePreferences,
} from "@/lib/profile/service"
import { createClient } from "@/lib/supabase/server"
import { updateAppearance, updateProfile } from "./settings"

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("@/lib/profile/service", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/profile/service")>()
  return {
    ...original,
    getMyProfileIdentity: vi.fn(),
    updateMyProfileIdentity: vi.fn(),
    updateMyProfilePreferences: vi.fn(),
  }
})

const current = {
  userId: "10000000-0000-4000-8000-000000000001",
  firstName: "Tristan",
  lastName: "Fleming",
  displayName: "Tristan Fleming",
  avatarPath: null,
  timezone: "UTC",
  themeMode: "system" as const,
  themeAccent: "default" as const,
  version: 4,
  updatedAt: "2026-07-15T12:00:00.000Z",
}

describe("profile settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: current.userId } } }),
      },
    } as never)
    vi.mocked(getMyProfileIdentity).mockResolvedValue(current)
    vi.mocked(updateMyProfileIdentity).mockResolvedValue({
      firstName: "Tristan",
      lastName: "Fleming",
      displayName: "Tristan Fleming",
      avatarPath: null,
      timezone: "UTC",
      version: 5,
      updatedAt: "2026-07-15T12:01:00.000Z",
    })
    vi.mocked(updateMyProfilePreferences).mockResolvedValue({
      themeMode: "dark",
      themeAccent: "blue",
      version: 5,
      updatedAt: "2026-07-15T12:01:00.000Z",
    })
  })

  it("preserves display-name compatibility while sending required canonical names", async () => {
    await expect(
      updateProfile({ display_name: "Ada Lovelace", timezone: "UTC" })
    ).resolves.toEqual({ ok: true, data: { version: 5 } })

    expect(updateMyProfileIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        firstName: "Tristan",
        lastName: "Fleming",
        displayName: "Ada Lovelace",
        expectedVersion: 4,
      })
    )
  })

  it("uses the caller's expected version and reports stale saves safely", async () => {
    vi.mocked(updateMyProfileIdentity).mockRejectedValue(
      new ProfileServiceError("profile_version_conflict")
    )

    await expect(
      updateProfile({
        first_name: "Tristan",
        last_name: "Fleming",
        expected_version: 3,
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "PROFILE_CONFLICT" },
    })
    expect(updateMyProfileIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedVersion: 3 })
    )
  })

  it("updates preferences through the same versioned profile boundary", async () => {
    await expect(
      updateAppearance({ theme_mode: "dark", theme_accent: "blue" })
    ).resolves.toEqual({ ok: true, data: {} })
    expect(updateMyProfilePreferences).toHaveBeenCalledWith(expect.anything(), {
      themeMode: "dark",
      themeAccent: "blue",
      expectedVersion: 4,
    })
  })
})
