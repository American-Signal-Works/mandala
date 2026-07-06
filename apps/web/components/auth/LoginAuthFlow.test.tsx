import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import {
  requestEmailMagicLink,
  requestOAuthSignIn,
  signOutCurrentSession,
} from "@/lib/auth/client"
import { LoginAuthFlow } from "./LoginAuthFlow"

vi.mock("@/lib/auth/client", () => ({
  requestEmailMagicLink: vi.fn(),
  requestOAuthSignIn: vi.fn(),
  signOutCurrentSession: vi.fn(),
}))

const requestEmailMagicLinkMock = vi.mocked(requestEmailMagicLink)
const requestOAuthSignInMock = vi.mocked(requestOAuthSignIn)
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
    window.history.replaceState(null, "", "/")
    requestEmailMagicLinkMock.mockReset()
    requestOAuthSignInMock.mockReset()
    signOutCurrentSessionMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders a theme-aware auth stack with dark Figma overrides", () => {
    const { container } = render(<LoginAuthFlow />)

    const shell = container.querySelector("main")
    const stack = container.querySelector('[data-auth-stack="true"]')

    expect(shell).toHaveClass(
      "min-h-svh",
      "bg-background",
      "text-foreground",
      "dark:bg-[#111111]",
      "dark:text-[#F0ECE6]"
    )
    expect(shell).not.toHaveClass("dark")
    expect(shell).not.toHaveAttribute("style")
    expect(stack).toHaveClass("max-w-96", "items-start")
    expect(stack).not.toHaveClass("max-w-xs")
    const mark = container.querySelector('[data-auth-mark="true"]')
    const markImages = mark?.querySelectorAll("img")
    expect(mark).toHaveClass("size-9", "shrink-0")
    expect(markImages).toHaveLength(2)
    expect(markImages?.[0]).toHaveClass("size-9", "dark:hidden")
    expect(markImages?.[1]).toHaveClass("hidden", "size-9", "dark:block")
    expect(screen.getByRole("heading", { name: "Sign in" })).toHaveClass(
      "text-2xl",
      "leading-none",
      "font-normal"
    )
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/sign-up"
    )
  })

  it("uses the Figma email field structure and exact terms copy", () => {
    const { container } = render(<LoginAuthFlow />)

    const emailInput = screen.getByLabelText("Or continue with email")
    const termsCopy = container.querySelector('[data-auth-terms="true"]')

    expect(
      container.querySelector('[data-slot="input-group"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-auth-email-input="true"]')
    ).toHaveClass(
      "rounded-[10px]",
      "border-border",
      "bg-input",
      "dark:border-[#3B3D3F]",
      "dark:bg-[#18191A]"
    )
    expect(emailInput).toHaveAttribute("type", "email")
    expect(emailInput).toHaveAttribute("placeholder", "user@example.com")
    expect(emailInput).toHaveAccessibleDescription("A link will be sent to you")
    expect(screen.queryByText("Email")).not.toBeInTheDocument()
    expect(termsCopy).toHaveTextContent(
      "By signing in you agree to our terms and privacy policy"
    )
    expect(screen.getByRole("link", { name: "terms" })).toBeVisible()
    expect(screen.getByRole("link", { name: "privacy policy" })).toBeVisible()
  })

  it("starts Supabase OAuth from the social buttons", async () => {
    requestOAuthSignInMock.mockResolvedValue({
      data: { url: "https://provider.example.com" },
      error: null,
    } as never)

    render(<LoginAuthFlow />)

    const googleButton = screen.getByRole("button", {
      name: "Sign in with Google",
    })
    const microsoftButton = screen.getByRole("button", {
      name: "Sign in with Microsoft",
    })

    expect(googleButton).not.toBeDisabled()
    expect(microsoftButton).not.toBeDisabled()
    expect(googleButton).toHaveClass(
      "h-10",
      "rounded-[10px]",
      "bg-secondary",
      "text-secondary-foreground",
      "dark:bg-[#18191A]",
      "dark:text-[#F0ECE6]"
    )
    expect(microsoftButton).toHaveClass(
      "h-10",
      "rounded-[10px]",
      "bg-secondary",
      "text-secondary-foreground",
      "dark:bg-[#18191A]",
      "dark:text-[#F0ECE6]"
    )
    expect(
      googleButton.querySelector('[data-auth-provider-icon="google"]')
    ).toBeInTheDocument()
    expect(
      microsoftButton.querySelector('[data-auth-provider-icon="microsoft"]')
    ).toBeInTheDocument()

    fireEvent.click(googleButton)

    await waitFor(() => {
      expect(requestOAuthSignInMock).toHaveBeenCalledWith("google")
    })

    fireEvent.click(microsoftButton)

    await waitFor(() => {
      expect(requestOAuthSignInMock).toHaveBeenLastCalledWith("azure")
    })
    expect(requestOAuthSignInMock).toHaveBeenCalledTimes(2)
    expect(requestEmailMagicLinkMock).not.toHaveBeenCalled()
    expect(signOutCurrentSessionMock).not.toHaveBeenCalled()
  })

  it("validates email before sending a magic link", async () => {
    render(<LoginAuthFlow />)

    const magicLinkButton = screen.getByRole("button", {
      name: "Send Magic Link",
    })

    expect(
      magicLinkButton.querySelector('[data-magic-link-icon="true"]')
    ).toBeInTheDocument()
    expect(magicLinkButton).toHaveClass(
      "auth-primary-button",
      "h-10",
      "rounded-[10px]",
      "bg-primary",
      "text-primary-foreground"
    )

    fireEvent.click(magicLinkButton)

    expect(
      await screen.findByText("Enter your email address.")
    ).not.toBeVisible()
    expect(requestEmailMagicLinkMock).not.toHaveBeenCalled()
  })

  it("sends a normalized email and advances to the Figma magic-link sent state", async () => {
    requestEmailMagicLinkMock.mockResolvedValue({
      data: {},
      error: null,
    } as never)

    const { container } = render(<LoginAuthFlow />)

    fireEvent.change(screen.getByLabelText("Or continue with email"), {
      target: { value: "  PERSON@Example.COM " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send Magic Link" }))

    await waitFor(() => {
      expect(requestEmailMagicLinkMock).toHaveBeenCalledWith(
        "person@example.com",
        { shouldCreateUser: false }
      )
    })
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeVisible()
    expect(screen.queryByText("Check your email")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Or continue with email")).toHaveValue(
      "person@example.com"
    )
    expect(screen.getByLabelText("Or continue with email")).toBeDisabled()
    expect(screen.getByLabelText("Or continue with email")).not.toHaveFocus()
    expect(
      screen.getByRole("button", { name: "Magic Link Sent" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByRole("button", { name: "Magic Link Sent" })
    ).toBeDisabled()
    expect(
      screen.queryByText("Didn't receive email?", { exact: false })
    ).not.toBeInTheDocument()
    expect(container.querySelector('[data-auth-stack="true"]')).toHaveClass(
      "max-w-96"
    )
    expect(container.querySelector('[data-auth-stack="true"]')).not.toHaveClass(
      "max-w-xs"
    )
  })

  it("returns the magic-link button to its default state after the cooldown", async () => {
    vi.useFakeTimers()
    requestEmailMagicLinkMock.mockResolvedValue({
      data: {},
      error: null,
    } as never)

    render(<LoginAuthFlow />)

    fireEvent.change(screen.getByLabelText("Or continue with email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send Magic Link" }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      screen.getByRole("button", { name: "Magic Link Sent" })
    ).toBeDisabled()
    expect(
      screen.queryByText("Didn't receive email?", { exact: false })
    ).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(
      screen.getByRole("button", { name: "Send Magic Link" })
    ).toBeEnabled()
    expect(screen.getByLabelText("Or continue with email")).toBeEnabled()
    expect(screen.getByLabelText("Or continue with email")).toHaveValue(
      "person@example.com"
    )
    expect(requestEmailMagicLinkMock).toHaveBeenCalledTimes(1)
  })

  it("renders sign-up mode and sends a sign-up magic link", async () => {
    requestEmailMagicLinkMock.mockResolvedValue({
      data: {},
      error: null,
    } as never)

    render(<LoginAuthFlow mode="sign-up" />)

    expect(screen.getByRole("heading", { name: "Sign up" })).toBeVisible()
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login"
    )
    expect(
      screen.getByRole("button", { name: "Sign up with Google" })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Sign up with Microsoft" })
    ).toBeVisible()
    expect(screen.getByText("By signing up", { exact: false })).toBeVisible()

    fireEvent.change(screen.getByLabelText("Or continue with email"), {
      target: { value: "new@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send Magic Link" }))

    await waitFor(() => {
      expect(requestEmailMagicLinkMock).toHaveBeenCalledWith(
        "new@example.com",
        { shouldCreateUser: true }
      )
    })
    expect(await screen.findByText("Magic Link Sent")).toBeVisible()
    expect(screen.getByRole("heading", { name: "Sign up" })).toBeVisible()
  })

  it("shows success from callback state and signs out back to sign in", async () => {
    signOutCurrentSessionMock.mockResolvedValue({ error: null } as never)

    render(<LoginAuthFlow initialStep="success" />)

    expect(screen.getByText("Sign in successful")).toBeVisible()
    expect(screen.queryByText("Login successful")).not.toBeInTheDocument()
    expect(document.querySelector('[data-auth-stack="true"]')).toHaveAttribute(
      "data-auth-step",
      "success"
    )
    expect(document.querySelector('[data-auth-stack="true"]')).toHaveClass(
      "max-w-96"
    )

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    await waitFor(() => {
      expect(signOutCurrentSessionMock).toHaveBeenCalled()
    })
    expect(window.location.pathname).toBe("/login")
    expect(window.location.search).toBe("")
    expect(
      await screen.findByRole("button", { name: "Send Magic Link" })
    ).toBeVisible()
  })
})
