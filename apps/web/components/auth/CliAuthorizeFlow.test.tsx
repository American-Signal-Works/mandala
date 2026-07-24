import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CliAuthorizeFlow } from "./CliAuthorizeFlow"
import { CliAuthorizationBootstrap } from "./CliAuthorizationBootstrap"

const companyId = "20000000-0000-4000-8000-000000000001"
const inspection = {
  authorizationId: "30000000-0000-4000-8000-000000000001",
  status: "pending" as const,
  clientName: "Mandala CLI",
  clientVersion: "0.0.0",
  clientPlatform: "darwin-arm64",
  requestedScopes: ["workspace:control" as const],
  expiresAt: "2030-01-01T00:10:00.000Z",
  selectedCompanyId: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("CLI browser approval", () => {
  it("removes the browser secret from history before bootstrapping", async () => {
    const browserToken = "b".repeat(43)
    const fetchImplementation = vi.fn().mockRejectedValue(new Error("offline"))
    vi.stubGlobal("fetch", fetchImplementation)
    window.history.replaceState(
      null,
      "",
      `/cli/authorize#request=${browserToken}`
    )

    render(
      <CliAuthorizationBootstrap>
        <CliAuthorizeFlow
          companies={[]}
          companyLoadFailed={false}
          inspection={null}
          signedInEmail={null}
        />
      </CliAuthorizationBootstrap>
    )

    expect(
      await screen.findByRole("heading", {
        name: "Terminal request unavailable",
      })
    ).toBeInTheDocument()
    expect(window.location.hash).toBe("")
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/mandala/cli/device-authorizations/bootstrap",
      expect.objectContaining({
        body: JSON.stringify({ browserToken }),
      })
    )
  })

  it("replaces a stale bound request when a fresh fragment arrives", async () => {
    const browserToken = "c".repeat(43)
    const fetchImplementation = vi.fn().mockRejectedValue(new Error("offline"))
    vi.stubGlobal("fetch", fetchImplementation)
    window.history.replaceState(
      null,
      "",
      `/cli/authorize#request=${browserToken}`
    )

    render(
      <CliAuthorizationBootstrap
        failureFallback={<p>Terminal request unavailable</p>}
        hasBoundRequest
      >
        <p>Old terminal request</p>
      </CliAuthorizationBootstrap>
    )

    expect(screen.queryByText("Old terminal request")).not.toBeInTheDocument()
    expect(
      await screen.findByText("Terminal request unavailable")
    ).toBeInTheDocument()
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/mandala/cli/device-authorizations/bootstrap",
      expect.objectContaining({
        body: JSON.stringify({ browserToken }),
      })
    )
  })

  it("shows request details and makes no decision before a deliberate click", () => {
    const fetchImplementation = vi.fn()
    vi.stubGlobal("fetch", fetchImplementation)

    renderApproval()

    expect(
      screen.getByRole("heading", { name: "Allow this CLI to access Mandala?" })
    ).toBeInTheDocument()
    expect(screen.getByText("Mandala CLI")).toBeInTheDocument()
    expect(
      screen.getByText(/darwin-arm64 · version 0.0.0/i)
    ).toBeInTheDocument()
    expect(screen.getByText("Requested access")).toBeInTheDocument()
    expect(screen.getByText(/normal approval rules/i)).toBeInTheDocument()
    expect(screen.getByText(/only approve if you started/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approve CLI" })).toBeDisabled()
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it("requires workspace selection and sends it only on approval", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "approved",
        company: { id: companyId, name: "Example Company" },
      })
    )
    vi.stubGlobal("fetch", fetchImplementation)
    renderApproval()

    fireEvent.click(screen.getByRole("radio", { name: /example company/i }))
    const approve = screen.getByRole("button", { name: "Approve CLI" })
    expect(approve).toBeEnabled()
    fireEvent.click(approve)

    expect(
      await screen.findByRole("heading", { name: "CLI approved" })
    ).toBeInTheDocument()
    await waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1))
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ decision: "approve", companyId }),
    })
  })

  it("denies without selecting or sending a workspace", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "denied" }))
    vi.stubGlobal("fetch", fetchImplementation)
    renderApproval()

    fireEvent.click(screen.getByRole("button", { name: "Deny" }))

    expect(
      await screen.findByRole("heading", { name: "Request denied" })
    ).toBeInTheDocument()
    expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ decision: "deny" }),
    })
    expect(JSON.stringify(fetchImplementation.mock.calls)).not.toContain(
      "companyId"
    )
  })

  it("does not accept an approval for a different workspace", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "approved",
        company: {
          id: "20000000-0000-4000-8000-000000000099",
          name: "Other Company",
        },
      })
    )
    vi.stubGlobal("fetch", fetchImplementation)
    renderApproval()

    fireEvent.click(screen.getByRole("radio", { name: /example company/i }))
    fireEvent.click(screen.getByRole("button", { name: "Approve CLI" }))

    expect(
      await screen.findByText(/could not save your decision/i)
    ).toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Allow this CLI to access Mandala?" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "CLI approved" })
    ).not.toBeInTheDocument()
  })

  it("keeps approval disabled when the account has no active workspace", () => {
    render(
      <CliAuthorizeFlow
        companies={[]}
        companyLoadFailed={false}
        inspection={inspection}
        signedInEmail="user@example.com"
      />
    )

    expect(
      screen.getByText(
        "This account does not have an active Mandala workspace."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approve CLI" })).toBeDisabled()
  })

  it("does not invite sign-in or code entry without a bound request", async () => {
    render(
      <CliAuthorizationBootstrap>
        <CliAuthorizeFlow
          companies={[]}
          companyLoadFailed={false}
          inspection={null}
          signedInEmail={null}
        />
      </CliAuthorizationBootstrap>
    )

    expect(
      await screen.findByRole("heading", {
        name: "Terminal request unavailable",
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Welcome to Mandala" })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })
})

function renderApproval() {
  return render(
    <CliAuthorizeFlow
      companies={[{ id: companyId, name: "Example Company", role: "owner" }]}
      companyLoadFailed={false}
      inspection={inspection}
      signedInEmail="user@example.com"
    />
  )
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
