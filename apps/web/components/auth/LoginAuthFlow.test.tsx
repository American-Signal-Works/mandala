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

  it("renders a theme-aware auth stack with Mandala tokens", () => {
    const { container } = render(<LoginAuthFlow />)

    const shell = container.querySelector("main")
    const frame = container.querySelector('[data-auth-frame="true"]')
    const panel = container.querySelector('[data-auth-panel="true"]')
    const stack = container.querySelector('[data-auth-stack="true"]')
    const visual = container.querySelector('[data-auth-visual="true"]')

    expect(shell).toHaveClass("min-h-svh", "bg-[#151617]", "text-[#f0ece3]")
    expect(shell).not.toHaveAttribute("style")
    expect(frame).toHaveClass("flex", "min-h-svh", "overflow-hidden")
    expect(frame?.firstElementChild).toHaveAttribute("data-auth-visual", "true")
    expect(frame?.lastElementChild).toHaveAttribute("data-auth-panel", "true")
    expect(panel).toHaveClass(
      "md:w-[560px]",
      "md:px-16",
      "md:py-24",
      "justify-between"
    )
    expect(stack).toHaveClass("max-w-[432px]", "items-start")
    expect(stack).not.toHaveClass("max-w-xs")
    const mark = container.querySelector('[data-auth-mark="true"]')
    const markImages = mark?.querySelectorAll("img")
    expect(mark).toHaveClass("size-10", "shrink-0")
    expect(markImages).toHaveLength(1)
    expect(markImages?.[0]).toHaveAttribute(
      "src",
      expect.stringContaining("auth-icon-mandala-dark.svg")
    )
    expect(visual).toHaveClass("hidden", "md:block", "flex-1")
    expect(visual?.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("auth-visual-dark.jpg")
    )
    expect(visual?.querySelector("img")).toHaveClass(
      "object-cover",
      "opacity-[0.03]"
    )
    expect(
      screen.getByRole("heading", { name: "Welcome to Mandala" })
    ).toHaveClass("text-2xl", "leading-none", "font-medium")
    expect(screen.getByText("Sign in or make an account")).toHaveClass(
      "text-sm",
      "leading-5",
      "text-[#cbced0]"
    )
    expect(
      screen.queryByRole("link", { name: "Sign up" })
    ).not.toBeInTheDocument()
  })

  it("uses the Figma email field structure and exact terms copy", () => {
    const { container } = render(<LoginAuthFlow />)

    const emailInput = screen.getByLabelText("Continue with email")
    const termsCopy = container.querySelector('[data-auth-terms="true"]')

    expect(
      container.querySelector('[data-slot="input-group"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-auth-email-input="true"]')
    ).toHaveClass("rounded-[10px]", "border-[#45484a]", "bg-[#2c2e30]")
    expect(emailInput).toHaveAttribute("type", "email")
    expect(emailInput).toHaveAttribute("placeholder", "user@example.com")
    expect(emailInput).toHaveAccessibleDescription("A link will be sent to you")
    expect(emailInput).not.toHaveFocus()
    expect(screen.queryByText("Email")).not.toBeInTheDocument()
    expect(termsCopy).toHaveClass("text-[#cbced0]", "text-sm", "leading-5")
    expect(termsCopy).toHaveTextContent("Terms and Privacy Policy")
    expect(screen.getByRole("link", { name: "Terms" })).toBeVisible()
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeVisible()
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
      "h-9",
      "rounded-[10px]",
      "border-transparent",
      "bg-[#2c2e30]",
      "text-[#f8f8f9]",
      "flex-1"
    )
    expect(microsoftButton).toHaveClass(
      "h-9",
      "rounded-[10px]",
      "border-transparent",
      "bg-[#2c2e30]",
      "text-[#f8f8f9]",
      "flex-1"
    )
    expect(googleButton).toHaveAttribute("title", "Sign in with Google")
    expect(microsoftButton).toHaveAttribute("title", "Sign in with Microsoft")
    expect(
      googleButton.querySelector('[data-auth-provider-icon="google"]')
    ).toHaveClass("size-4")
    expect(
      googleButton.querySelector('[data-auth-provider-icon="google"]')
    ).toHaveAttribute(
      "src",
      expect.stringContaining("auth-provider-google.svg")
    )
    expect(
      microsoftButton.querySelector('[data-auth-provider-icon="microsoft"]')
    ).toHaveClass("size-4")
    expect(
      microsoftButton.querySelector('[data-auth-provider-icon="microsoft"]')
    ).toHaveAttribute(
      "src",
      expect.stringContaining("auth-provider-microsoft.svg")
    )

    fireEvent.click(googleButton)

    await waitFor(() => {
      expect(requestOAuthSignInMock).toHaveBeenCalledWith("google")
    })
    expect(
      screen.queryByText("Redirecting to Google...")
    ).not.toBeInTheDocument()
    expect(googleButton).toBeDisabled()
    expect(microsoftButton).toBeDisabled()
    expect(
      googleButton.querySelector('[data-auth-provider-icon="google"]')
    ).not.toBeInTheDocument()
    expect(
      microsoftButton.querySelector('[data-auth-provider-icon="microsoft"]')
    ).toBeInTheDocument()
    expect(googleButton.querySelector('[role="status"]')).toBeInTheDocument()
    expect(
      microsoftButton.querySelector('[role="status"]')
    ).not.toBeInTheDocument()
  })

  it("starts Microsoft OAuth from the Microsoft social button", async () => {
    requestOAuthSignInMock.mockResolvedValue({
      data: { url: "https://provider.example.com" },
      error: null,
    } as never)

    render(<LoginAuthFlow />)

    const microsoftButton = screen.getByRole("button", {
      name: "Sign in with Microsoft",
    })

    fireEvent.click(microsoftButton)

    await waitFor(() => {
      expect(requestOAuthSignInMock).toHaveBeenLastCalledWith("azure")
    })
    expect(requestOAuthSignInMock).toHaveBeenCalledTimes(1)
    expect(requestEmailMagicLinkMock).not.toHaveBeenCalled()
    expect(signOutCurrentSessionMock).not.toHaveBeenCalled()
  })

  it("validates email before sending a magic link", async () => {
    const { container } = render(<LoginAuthFlow />)

    const magicLinkButton = screen.getByRole("button", {
      name: "Send magic link",
    })

    expect(
      magicLinkButton.querySelector('[data-magic-link-icon="true"]')
    ).toBeInTheDocument()
    expect(magicLinkButton).toHaveClass(
      "auth-primary-button",
      "h-10",
      "rounded-[10px]",
      "bg-[#4b60ff]",
      "text-[#f8f8f9]"
    )

    fireEvent.click(magicLinkButton)

    expect(
      await screen.findByText("Please enter your email", {
        selector: "label",
      })
    ).toBeVisible()
    expect(
      screen.getByRole("textbox", { name: "Please enter your email" })
    ).toHaveFocus()
    expect(
      container.querySelector('[data-auth-email-input="true"]')
    ).toHaveClass("border-[#e55767]")
    expect(magicLinkButton).toBeDisabled()
    expect(requestEmailMagicLinkMock).not.toHaveBeenCalled()
  })

  it("shows the Figma invalid email state for malformed email", async () => {
    const { container } = render(<LoginAuthFlow />)

    const emailInput = screen.getByLabelText("Continue with email")
    fireEvent.change(emailInput, {
      target: { value: "user@example.c" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }))

    expect(
      await screen.findByText("Invalid email", { selector: "label" })
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "Invalid email" })).toHaveValue(
      "user@example.c"
    )
    expect(
      container.querySelector('[data-auth-email-input="true"]')
    ).toHaveClass("border-[#e55767]")
    expect(
      screen.getByRole("button", { name: "Send magic link" })
    ).toBeDisabled()
    expect(requestEmailMagicLinkMock).not.toHaveBeenCalled()
  })

  it("sends a normalized email and advances to the Figma magic-link sent state", async () => {
    requestEmailMagicLinkMock.mockResolvedValue({
      data: {},
      error: null,
    } as never)

    const { container } = render(<LoginAuthFlow />)

    fireEvent.change(screen.getByLabelText("Continue with email"), {
      target: { value: "  PERSON@Example.COM " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }))

    await waitFor(() => {
      expect(requestEmailMagicLinkMock).toHaveBeenCalledWith(
        "person@example.com",
        { shouldCreateUser: false }
      )
    })
    expect(
      screen.getByRole("heading", { name: "Welcome to Mandala" })
    ).toBeVisible()
    expect(screen.queryByText("Check your email")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Continue with email")).toHaveValue(
      "person@example.com"
    )
    expect(screen.getByLabelText("Continue with email")).toBeDisabled()
    expect(screen.getByLabelText("Continue with email")).not.toHaveFocus()
    expect(
      screen.getByRole("button", { name: "Magic link sent" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByRole("button", { name: "Magic link sent" })
    ).toBeDisabled()
    expect(
      screen.queryByText("Didn't receive email?", { exact: false })
    ).not.toBeInTheDocument()
    expect(container.querySelector('[data-auth-stack="true"]')).toHaveClass(
      "max-w-[432px]"
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

    fireEvent.change(screen.getByLabelText("Continue with email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }))

    await act(async () => {
      await Promise.resolve()
    })

    expect(
      screen.getByRole("button", { name: "Magic link sent" })
    ).toBeDisabled()
    expect(
      screen.queryByText("Didn't receive email?", { exact: false })
    ).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(
      screen.getByRole("button", { name: "Send magic link" })
    ).toBeEnabled()
    expect(screen.getByLabelText("Continue with email")).toBeEnabled()
    expect(screen.getByLabelText("Continue with email")).toHaveValue(
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

    expect(
      screen.getByRole("heading", { name: "Welcome to Mandala" })
    ).toBeVisible()
    expect(
      screen.queryByRole("link", { name: "Sign in" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Sign in with Google" })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Sign in with Microsoft" })
    ).toBeVisible()
    expect(screen.getByText("Sign in or make an account")).toBeVisible()
    expect(screen.getByText("Terms")).toBeVisible()

    fireEvent.change(screen.getByLabelText("Continue with email"), {
      target: { value: "new@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }))

    await waitFor(() => {
      expect(requestEmailMagicLinkMock).toHaveBeenCalledWith(
        "new@example.com",
        { shouldCreateUser: true }
      )
    })
    expect(await screen.findByText("Magic link sent")).toBeVisible()
    expect(
      screen.getByRole("heading", { name: "Welcome to Mandala" })
    ).toBeVisible()
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
      "max-w-[432px]"
    )

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))

    await waitFor(() => {
      expect(signOutCurrentSessionMock).toHaveBeenCalled()
    })
    expect(window.location.pathname).toBe("/login")
    expect(window.location.search).toBe("")
    expect(
      await screen.findByRole("button", { name: "Send magic link" })
    ).toBeVisible()
  })
})
