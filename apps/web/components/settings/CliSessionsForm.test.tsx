import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { CliSessionsForm } from "./CliSessionsForm"

const { toast } = vi.hoisted(() => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock("sonner", () => ({ toast }))

const firstSession = {
  id: "30000000-0000-4000-8000-000000000001",
  selectedCompanyId: "20000000-0000-4000-8000-000000000001",
  selectedCompanyName: "Dirt King",
  scopes: ["workspace:control"] as const,
  clientName: "Mandala CLI",
  clientVersion: "1.2.3",
  clientPlatform: "darwin-arm64",
  createdAt: "2026-07-24T10:00:00.000Z",
  lastUsedAt: "2026-07-24T11:00:00.000Z",
  revokedAt: null,
}

const secondSession = {
  ...firstSession,
  id: "30000000-0000-4000-8000-000000000002",
  selectedCompanyName: null,
  clientName: "Warehouse CLI",
  clientPlatform: "win32-x64",
}

describe("CliSessionsForm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders safe session metadata and no raw identifiers or tokens", async () => {
    mockFetch(jsonResponse({ sessions: [firstSession, secondSession] }))

    render(<CliSessionsForm />)

    expect(await screen.findByText("Dirt King")).toBeInTheDocument()
    expect(screen.getByText("macOS")).toBeInTheDocument()
    expect(screen.getByText("Windows")).toBeInTheDocument()
    expect(screen.getByText("Workspace unavailable")).toBeInTheDocument()
    expect(screen.getAllByText("Active")).toHaveLength(2)
    expect(document.body.textContent).not.toContain(firstSession.id)
    expect(document.body.textContent).not.toMatch(/mdl_cli_(?:at|rt)_/)
  })

  it("revokes one session, refreshes persisted state, and leaves the other active", async () => {
    mockFetch(
      jsonResponse({ sessions: [firstSession, secondSession] }),
      jsonResponse({ sessionId: firstSession.id, revoked: true }),
      jsonResponse({
        sessions: [
          { ...firstSession, revokedAt: "2026-07-24T12:00:00.000Z" },
          secondSession,
        ],
      })
    )

    render(<CliSessionsForm />)
    await screen.findByText("Dirt King")

    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!)
    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke session" })
    )

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("CLI session revoked.")
      expect(screen.getAllByText("Revoked")).toHaveLength(1)
      expect(screen.getAllByText("Active")).toHaveLength(1)
    })
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/mandala/cli/sessions",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ sessionId: firstSession.id }),
      })
    )
  })

  it("revokes all active sessions and shows the empty-active state", async () => {
    mockFetch(
      jsonResponse({ sessions: [firstSession, secondSession] }),
      jsonResponse({ revokedCount: 2 }),
      jsonResponse({
        sessions: [
          { ...firstSession, revokedAt: "2026-07-24T12:00:00.000Z" },
          { ...secondSession, revokedAt: "2026-07-24T12:00:00.000Z" },
        ],
      })
    )

    render(<CliSessionsForm />)
    fireEvent.click(await screen.findByRole("button", { name: "Revoke all" }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke all sessions" })
    )

    await waitFor(() => {
      expect(screen.getAllByText("Revoked")).toHaveLength(2)
      expect(
        screen.queryByRole("button", { name: "Revoke all" })
      ).not.toBeInTheDocument()
    })
  })

  it("keeps the list unchanged and shows a safe error when revocation fails", async () => {
    mockFetch(
      jsonResponse({ sessions: [firstSession] }),
      jsonResponse({ error: "session_revoke_failed" }, 500)
    )

    render(<CliSessionsForm />)
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke session" })
    )

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "The CLI session could not be revoked. Try again."
      )
    })
    expect(screen.getByText("Active")).toBeInTheDocument()
  })

  it("keeps the confirmed revoked state when the follow-up refresh fails", async () => {
    mockFetch(
      jsonResponse({ sessions: [firstSession] }),
      jsonResponse({ sessionId: firstSession.id, revoked: true }),
      jsonResponse({ error: "session_list_failed" }, 500)
    )

    render(<CliSessionsForm />)
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }))
    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke session" })
    )

    await waitFor(() => {
      expect(screen.getByText("Revoked")).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "Revoke" })
      ).not.toBeInTheDocument()
      expect(toast.warning).toHaveBeenCalledWith(
        "The session was revoked, but the list could not refresh. Reload this page to confirm."
      )
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("disables every revoke action while a request is pending", async () => {
    let finishRevocation!: (response: Response) => void
    const pendingRevocation = new Promise<Response>((resolve) => {
      finishRevocation = resolve
    })
    const mockedFetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ sessions: [firstSession, secondSession] })
      )
      .mockReturnValueOnce(pendingRevocation)
      .mockResolvedValueOnce(
        jsonResponse({
          sessions: [
            { ...firstSession, revokedAt: "2026-07-24T12:00:00.000Z" },
            secondSession,
          ],
        })
      )
    vi.stubGlobal("fetch", mockedFetch)

    render(<CliSessionsForm />)
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Revoke" }))[0]!
    )
    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke session" })
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Revoke all" })).toBeDisabled()
      for (const button of screen.getAllByRole("button", { name: "Revoke" })) {
        expect(button).toBeDisabled()
      }
    })

    finishRevocation(
      jsonResponse({ sessionId: firstSession.id, revoked: true })
    )
    await waitFor(() => expect(screen.getAllByText("Active")).toHaveLength(1))
  })

  it("renders empty and retryable list-failure states", async () => {
    mockFetch(jsonResponse({ sessions: [] }))
    const { unmount } = render(<CliSessionsForm />)
    expect(await screen.findByText("No CLI sessions")).toBeInTheDocument()
    unmount()

    mockFetch(jsonResponse({ error: "session_list_failed" }, 500))
    render(<CliSessionsForm />)
    expect(
      await screen.findByText("Sessions could not be loaded")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled()
  })

  it("recovers from a list failure when retry succeeds", async () => {
    mockFetch(
      jsonResponse({ error: "session_list_failed" }, 500),
      jsonResponse({ sessions: [firstSession] })
    )

    render(<CliSessionsForm />)
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }))

    expect(await screen.findByText("Dirt King")).toBeInTheDocument()
    expect(screen.getByText("Active")).toBeInTheDocument()
  })
})

function mockFetch(...responses: Response[]) {
  const mocked = vi.fn()
  for (const response of responses) mocked.mockResolvedValueOnce(response)
  vi.stubGlobal("fetch", mocked)
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
