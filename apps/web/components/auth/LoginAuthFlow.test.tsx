import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { LoginAuthFlow } from "./LoginAuthFlow"
import { requestEmailMagicLink, signOutCurrentSession } from "@/lib/auth/client"

vi.mock("@/lib/auth/client", () => ({
  requestEmailMagicLink: vi.fn(),
  signOutCurrentSession: vi.fn(),
}))

const requestEmailMagicLinkMock = vi.mocked(requestEmailMagicLink)
const signOutCurrentSessionMock = vi.mocked(signOutCurrentSession)

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  document.elementFromPoint = () => document.activeElement
})

describe("LoginAuthFlow", () => {
  beforeEach(() => {
    requestEmailMagicLinkMock.mockReset()
    signOutCurrentSessionMock.mockReset()
  })

  it("follows the app theme instead of forcing dark mode", () => {
    const { container } = render(<LoginAuthFlow />)

    const shell = container.querySelector("main")
    expect(shell).toHaveClass("min-h-svh")
    expect(shell).not.toHaveClass("dark")
  })

  it("uses the Figma primary token in light mode and keeps a dark mode override", () => {
    const { container } = render(<LoginAuthFlow />)

    const shell = container.querySelector("main")
    expect(shell).toHaveClass("[--primary:oklch(0.205_0_0)]")
    expect(shell).toHaveClass("[--primary-foreground:oklch(0.985_0_0)]")
    expect(shell).toHaveClass("dark:[--primary:oklch(0.922_0_0)]")
    expect(shell).toHaveClass("dark:[--primary-foreground:oklch(0.205_0_0)]")
  })

  it("shows visible but unavailable social buttons", () => {
    render(<LoginAuthFlow />)

    const googleButton = screen.getByRole("button", {
      name: "Login with Google",
    })
    const microsoftButton = screen.getByRole("button", {
      name: "Login with Microsoft",
    })

    expect(googleButton).toHaveAttribute("aria-disabled", "true")
    expect(microsoftButton).toHaveAttribute("aria-disabled", "true")
    expect(googleButton).not.toBeDisabled()
    expect(microsoftButton).not.toBeDisabled()

    fireEvent.click(googleButton)
    fireEvent.click(microsoftButton)

    expect(requestEmailMagicLinkMock).not.toHaveBeenCalled()
  })

  it("validates email before sending a magic link", async () => {
    render(<LoginAuthFlow />)

    fireEvent.click(screen.getByRole("button", { name: "Login" }))

    expect(await screen.findByText("Enter your email address.")).toBeVisible()
    expect(requestEmailMagicLinkMock).not.toHaveBeenCalled()
  })

  it("sends a normalized email and advances to magic link instructions", async () => {
    requestEmailMagicLinkMock.mockResolvedValue({
      data: {},
      error: null,
    } as never)

    render(<LoginAuthFlow />)

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "  PERSON@Example.COM " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Login" }))

    await waitFor(() => {
      expect(requestEmailMagicLinkMock).toHaveBeenCalledWith(
        "person@example.com"
      )
    })
    expect(await screen.findByText("Check your email")).toBeVisible()
    expect(
      screen.getByText("We sent a sign-in link to person@example.com.")
    ).toBeVisible()
  })

  it("resends a magic link from the email instructions", async () => {
    requestEmailMagicLinkMock.mockResolvedValue({
      data: {},
      error: null,
    } as never)

    render(<LoginAuthFlow />)

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Login" }))

    await screen.findByText("Check your email")

    fireEvent.click(screen.getByRole("button", { name: "Resend link" }))

    await waitFor(() => {
      expect(requestEmailMagicLinkMock).toHaveBeenCalledTimes(2)
    })
    expect(requestEmailMagicLinkMock).toHaveBeenLastCalledWith(
      "person@example.com"
    )
    expect(
      await screen.findByText("A new sign-in link was sent.")
    ).toBeVisible()
  })

  it("shows success from callback state and logs out back to sign in", async () => {
    signOutCurrentSessionMock.mockResolvedValue({ error: null } as never)

    render(<LoginAuthFlow initialStep="success" />)

    expect(screen.getByText("Login successful")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Logout" }))

    await waitFor(() => {
      expect(signOutCurrentSessionMock).toHaveBeenCalled()
    })
    expect(await screen.findByRole("button", { name: "Login" })).toBeVisible()
  })
})
