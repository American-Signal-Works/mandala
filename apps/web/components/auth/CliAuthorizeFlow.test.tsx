import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CliAuthorizeFlow } from "./CliAuthorizeFlow"
import { CliAuthorizationBootstrap } from "./CliAuthorizationBootstrap"

vi.mock("@/components/auth/LoginAuthFlow", () => ({
  LoginAuthFlow: ({
    initialFormMessage,
    initialStep,
  }: {
    initialFormMessage?: string | null
    initialStep?: string
  }) => (
    <main data-testid="login-screen">
      <h1>Welcome to Mandala</h1>
      <span>{initialStep}</span>
      {initialFormMessage ? <p>{initialFormMessage}</p> : null}
    </main>
  ),
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("CLI browser authentication", () => {
  it("removes the browser secret from history before bootstrapping", async () => {
    const browserToken = "b".repeat(43)
    const fetchImplementation = vi.fn().mockRejectedValue(new Error("offline"))
    vi.stubGlobal("fetch", fetchImplementation)
    window.history.replaceState(
      null,
      "",
      `/cli/authorize#request=${browserToken}`
    )

    render(<CliAuthorizationBootstrap />)

    expect(
      screen.getByRole("heading", { name: "Welcome to Mandala" })
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
      <CliAuthorizationBootstrap hasBoundRequest>
        <p>Old terminal request</p>
      </CliAuthorizationBootstrap>
    )

    expect(screen.queryByText("Old terminal request")).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Welcome to Mandala" })
    ).toBeInTheDocument()
  })

  it("finishes the bound terminal request automatically after sign-in", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: "approved" }))
    vi.stubGlobal("fetch", fetchImplementation)

    render(<CliAuthorizeFlow requestAvailable />)

    expect(
      screen.getByRole("heading", { name: "Welcome to Mandala" })
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchImplementation).toHaveBeenCalledWith(
        "/api/mandala/cli/device-authorizations/decision",
        expect.objectContaining({
          body: JSON.stringify({ decision: "approve" }),
        })
      )
    )
    expect(JSON.stringify(fetchImplementation.mock.calls)).not.toContain(
      "companyId"
    )
    expect(await screen.findByText("success")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /approve cli/i })).toBeNull()
    expect(screen.queryByText(/workspace/i)).toBeNull()
  })

  it("keeps failures inside the normal login surface", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "failed" }, 500))
    )

    render(<CliAuthorizeFlow requestAvailable />)

    expect(
      await screen.findByText(/couldn't connect this sign-in to the terminal/i)
    ).toBeInTheDocument()
    expect(screen.getByTestId("login-screen")).toBeInTheDocument()
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
