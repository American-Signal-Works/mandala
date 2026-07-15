// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAdminClient } from "@/lib/supabase/admin"
import { isRecentSessionAuthentication } from "@/lib/auth/recent-auth"
import { createClient } from "@/lib/supabase/server"
import { deleteAccount } from "./delete-account"

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

const userId = "10000000-0000-4000-8000-000000000001"

function deleteQuery(
  error: { message: string } | null = null,
  requiredEqualities = 2
) {
  let equalityCount = 0
  const query = {
    delete: vi.fn(() => query),
    eq: vi.fn(() => {
      equalityCount += 1
      return equalityCount < requiredEqualities
        ? query
        : Promise.resolve({ error })
    }),
  }
  return query
}

function setup(options?: {
  cleanupError?: boolean
  preflightError?: string
  recent?: boolean
  signOutError?: boolean
}) {
  const authenticatedAt =
    options?.recent === false
      ? Math.floor((Date.now() - 60 * 60 * 1000) / 1000)
      : Math.floor(Date.now() / 1000)
  const signOut = vi.fn().mockResolvedValue({
    error: options?.signOutError ? { message: "failed" } : null,
  })
  const userClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: userId,
          },
        },
      }),
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "current-user-jwt" } },
        error: null,
      }),
      getClaims: vi.fn().mockResolvedValue({
        data: {
          claims: {
            amr: [{ method: "otp", timestamp: authenticatedAt }],
            session_id: "current-session-id",
            sub: userId,
          },
        },
        error: null,
      }),
      signOut,
    },
    rpc: vi.fn().mockResolvedValue({
      data: null,
      error: options?.preflightError
        ? { message: options.preflightError }
        : null,
    }),
  }

  const collections = deleteQuery(
    options?.cleanupError ? { message: "failed" } : null
  )
  const profiles = deleteQuery(null, 1)
  const pages = deleteQuery()
  const imports = deleteQuery()
  const remove = vi.fn().mockResolvedValue({ error: null })
  const list = vi.fn().mockResolvedValue({ data: [], error: null })
  const deleteUser = vi.fn().mockResolvedValue({ error: null })
  const adminSignOut = vi.fn().mockResolvedValue({ error: null })
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "profiles") return profiles
      if (table === "collections") return collections
      if (table === "pages") return pages
      return imports
    }),
    storage: { from: vi.fn(() => ({ list, remove })) },
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: { admin: { deleteUser, signOut: adminSignOut } },
  }

  vi.mocked(createClient).mockResolvedValue(userClient as never)
  vi.mocked(createAdminClient).mockReturnValue(admin as never)
  return {
    admin,
    adminSignOut,
    deleteUser,
    list,
    remove,
    signOut,
    userClient,
  }
}

describe("safe account deletion", () => {
  beforeEach(() => vi.clearAllMocks())

  it("requires a recent server-verified sign-in before preflight", async () => {
    const { userClient } = setup({ recent: false })

    await expect(deleteAccount()).resolves.toMatchObject({
      ok: false,
      error: { code: "REAUTHENTICATION_REQUIRED" },
    })
    expect(userClient.rpc).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("stops before destructive work when the user is a final Owner", async () => {
    setup({ preflightError: "account_deletion_final_owner" })

    await expect(deleteAccount()).resolves.toMatchObject({
      ok: false,
      error: { code: "ACCOUNT_OWNERSHIP_BLOCKED" },
    })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("records recoverable cleanup after access and Auth are already disabled", async () => {
    const { admin, adminSignOut, deleteUser } = setup({ cleanupError: true })

    await expect(deleteAccount()).resolves.toMatchObject({
      ok: false,
      error: { code: "DELETE_CLEANUP_PENDING" },
    })
    expect(adminSignOut).toHaveBeenCalledWith("current-user-jwt", "global")
    expect(deleteUser).toHaveBeenCalledWith(userId, true)
    expect(admin.rpc).toHaveBeenCalledWith(
      "record_account_deletion_progress",
      expect.objectContaining({
        p_status: "cleanup_failed",
        p_user_id: userId,
      })
    )
  })

  it("revokes every session before soft-deleting Auth, then cleans personal data", async () => {
    const { admin, adminSignOut, deleteUser, signOut } = setup()

    await expect(deleteAccount()).resolves.toEqual({ ok: true, data: {} })
    expect(adminSignOut).toHaveBeenCalledWith("current-user-jwt", "global")
    expect(signOut).toHaveBeenCalledWith({ scope: "local" })
    expect(deleteUser).toHaveBeenCalledWith(userId, true)
    expect(adminSignOut.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUser.mock.invocationCallOrder[0]!
    )
    expect(deleteUser.mock.invocationCallOrder[0]).toBeLessThan(
      admin.from.mock.invocationCallOrder[0]!
    )
    expect(admin.rpc).toHaveBeenCalledWith(
      "record_account_deletion_progress",
      expect.objectContaining({ p_status: "completed", p_user_id: userId })
    )
  })

  it("removes every storage page before marking deletion complete", async () => {
    const { list, remove } = setup()
    const firstPage = Array.from({ length: 1_000 }, (_, index) => ({
      name: `avatar-${index}.png`,
    }))
    list
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({
        data: [{ name: "avatar-last.png" }],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })

    await expect(deleteAccount()).resolves.toEqual({ ok: true, data: {} })
    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove.mock.calls[0]?.[0]).toHaveLength(1_000)
    expect(remove.mock.calls[1]?.[0]).toEqual([`${userId}/avatar-last.png`])
  })
})

describe("recent authentication check", () => {
  it("requires a recent authentication method bound to the current session user", () => {
    const now = Date.parse("2026-07-15T12:00:00.000Z")
    const claims = (timestamp: string, sub = userId) => ({
      amr: [{ method: "otp", timestamp: Date.parse(timestamp) / 1_000 }],
      session_id: "current-session-id",
      sub,
    })

    expect(isRecentSessionAuthentication(undefined, userId, now)).toBe(false)
    expect(
      isRecentSessionAuthentication(
        claims("2026-07-15T12:01:00.000Z"),
        userId,
        now
      )
    ).toBe(false)
    expect(
      isRecentSessionAuthentication(
        claims("2026-07-15T11:44:59.000Z"),
        userId,
        now
      )
    ).toBe(false)
    expect(
      isRecentSessionAuthentication(
        claims("2026-07-15T11:45:00.000Z"),
        userId,
        now
      )
    ).toBe(true)
    expect(
      isRecentSessionAuthentication(
        claims("2026-07-15T12:00:00.000Z", "another-user"),
        userId,
        now
      )
    ).toBe(false)
  })
})
