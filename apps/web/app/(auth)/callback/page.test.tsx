import { render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AuthCallbackClient } from "./AuthCallbackClient"
import { createClient } from "@/lib/supabase/browser"

const routerReplaceMock = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
  }),
}))

vi.mock("@/lib/supabase/browser", () => ({
  createClient: vi.fn(),
}))

const createClientMock = vi.mocked(createClient)

describe("AuthCallbackPage", () => {
  beforeEach(() => {
    routerReplaceMock.mockReset()
    createClientMock.mockReset()
    window.history.replaceState(null, "", "/")
  })

  it("exchanges OAuth codes and redirects to the success screen", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null })
    const getSession = vi.fn()

    createClientMock.mockReturnValue({
      auth: {
        exchangeCodeForSession,
        getSession,
      },
    } as never)
    window.history.replaceState(
      null,
      "",
      "/callback?code=oauth-code&next=%2Flogin%3Fauth%3Dsuccess"
    )

    render(<AuthCallbackClient initialPendingAction="google" />)

    expect(screen.queryByText("Completing sign in...")).not.toBeInTheDocument()
    const googleButton = screen.getByRole("button", {
      name: "Sign in with Google",
    })
    const microsoftButton = screen.getByRole("button", {
      name: "Sign in with Microsoft",
    })
    expect(googleButton).toBeDisabled()
    expect(microsoftButton).toBeDisabled()
    expect(googleButton.querySelector('[role="status"]')).toBeInTheDocument()
    expect(
      microsoftButton.querySelector('[role="status"]')
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith("oauth-code")
    })
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/login?auth=success")
    })
    expect(getSession).not.toHaveBeenCalled()
  })

  it("verifies magic-link callbacks while showing the email button loading state", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ error: null })
    const getSession = vi.fn()

    createClientMock.mockReturnValue({
      auth: {
        getSession,
        verifyOtp,
      },
    } as never)
    window.history.replaceState(
      null,
      "",
      "/callback?token_hash=email-token&method=email&next=%2Flogin%3Fauth%3Dsuccess"
    )

    render(<AuthCallbackClient initialPendingAction="send" />)

    expect(screen.queryByText("Completing sign in...")).not.toBeInTheDocument()
    const magicLinkButton = document.querySelector<HTMLButtonElement>(
      '[data-auth-primary-action="true"]'
    )
    expect(magicLinkButton).not.toBeNull()
    const magicLinkButtonElement = magicLinkButton as HTMLButtonElement
    expect(magicLinkButtonElement).toBeDisabled()
    expect(magicLinkButtonElement).toHaveTextContent("Sending email")
    expect(
      magicLinkButtonElement.querySelector('[role="status"]')
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(verifyOtp).toHaveBeenCalledWith({
        token_hash: "email-token",
        type: "email",
      })
    })
    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/login?auth=success")
    })
    expect(getSession).not.toHaveBeenCalled()
  })
})
