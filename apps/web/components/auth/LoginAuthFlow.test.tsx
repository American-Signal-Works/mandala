import { readFileSync } from "node:fs"
import { resolve } from "node:path"
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
  confirmCurrentSession,
  requestEmailMagicLink,
  requestOAuthSignIn,
  signOutCurrentSession,
} from "@/lib/auth/client"
import { LoginAuthFlow } from "./LoginAuthFlow"

vi.mock("@/lib/auth/client", () => ({
  confirmCurrentSession: vi.fn(),
  requestEmailMagicLink: vi.fn(),
  requestOAuthSignIn: vi.fn(),
  signOutCurrentSession: vi.fn(),
}))

const requestEmailMagicLinkMock = vi.mocked(requestEmailMagicLink)
const requestOAuthSignInMock = vi.mocked(requestOAuthSignIn)
const signOutCurrentSessionMock = vi.mocked(signOutCurrentSession)
const confirmCurrentSessionMock = vi.mocked(confirmCurrentSession)

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
    confirmCurrentSessionMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps auth colors bound to semantic theme tokens", () => {
    const source = readFileSync(
      resolve(process.cwd(), "components/auth/LoginAuthFlow.tsx"),
      "utf8"
    )

    expect(source).not.toMatch(/\b(?:bg|text|border|ring)-\[#/)
    expect(source).toContain("bg-background")
    expect(source).toContain("text-foreground")
    expect(source).toContain("bg-primary")
    expect(source).toContain("bg-secondary")
    expect(source).toContain("text-muted-foreground")
    expect(source).toContain("text-destructive")
    expect(source).toContain("var(--destructive)")
  })

  it("renders a theme-aware auth stack with Mandala tokens", () => {
    const { container } = render(<LoginAuthFlow />)

    const shell = container.querySelector("main")
    const frame = container.querySelector('[data-auth-frame="true"]')
    const panel = container.querySelector('[data-auth-panel="true"]')
    const stack = container.querySelector('[data-auth-stack="true"]')
    const visual = container.querySelector('[data-auth-visual="true"]')

    expect(shell).toHaveClass("min-h-svh", "bg-background", "text-foreground")
    expect(shell).not.toHaveAttribute("style")
    expect(frame).toHaveClass(
      "flex",
      "min-h-svh",
      "overflow-hidden",
      "bg-background"
    )
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
    expect(markImages).toHaveLength(2)
    expect(markImages?.[0]).toHaveClass("dark:hidden")
    expect(markImages?.[0]).toHaveAttribute(
      "src",
      expect.stringContaining("auth-icon-light.svg")
    )
    expect(markImages?.[1]).toHaveClass("hidden", "dark:block")
    expect(markImages?.[1]).toHaveAttribute(
      "src",
      expect.stringContaining("auth-icon-dark.svg")
    )
    expect(visual).toHaveClass("hidden", "md:block", "flex-1")
    expect(visual?.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("auth-visual-dark.jpg")
    )
    expect(visual?.querySelector("img")).toHaveClass(
      "object-cover",
      "opacity-[0.03]",
      "outline-black/10",
      "dark:outline-white/10"
    )
    expect(
      screen.getByRole("heading", { name: "Welcome to Mandala" })
    ).toHaveClass("text-balance", "text-2xl", "leading-none", "font-medium")
    expect(screen.getByText("Sign in or make an account")).toHaveClass(
      "text-pretty",
      "text-sm",
      "leading-5",
      "text-muted-foreground"
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
    ).toHaveClass(
      "rounded-[10px]",
      "border-transparent",
      "bg-input",
      "bg-clip-padding"
    )
    expect(
      container.querySelector('[data-auth-email-input="true"]')
    ).not.toHaveClass("shadow-none")
    expect(
      container.querySelector('[data-auth-email-input="true"]')?.className
    ).toContain(
      "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%"
    )
    expect(
      container.querySelector('[data-auth-email-input="true"]')?.className
    ).toContain(
      "hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_9%"
    )
    expect(
      container.querySelector('[data-auth-email-input="true"]')?.className
    ).toContain(
      "dark:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%"
    )
    expect(emailInput).toHaveAttribute("type", "email")
    expect(emailInput).toHaveAttribute("placeholder", "user@example.com")
    expect(emailInput).toHaveAccessibleDescription("A link will be sent to you")
    expect(emailInput).not.toHaveFocus()
    expect(screen.queryByText("Email")).not.toBeInTheDocument()
    expect(termsCopy).toHaveClass(
      "text-muted-foreground",
      "text-sm",
      "leading-5"
    )
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
      "h-10",
      "rounded-[10px]",
      "border-transparent",
      "bg-secondary",
      "text-secondary-foreground",
      "flex-1"
    )
    expect(microsoftButton).toHaveClass(
      "h-10",
      "rounded-[10px]",
      "border-transparent",
      "bg-secondary",
      "text-secondary-foreground",
      "flex-1"
    )
    expect(googleButton).toHaveAttribute("title", "Sign in with Google")
    expect(microsoftButton).toHaveAttribute("title", "Sign in with Microsoft")
    expect(googleButton.className).toContain(
      "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_6%"
    )
    expect(googleButton.className).toContain(
      "hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_9%"
    )
    expect(googleButton.className).toContain(
      "dark:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_8%"
    )
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
    ).toBeInTheDocument()
    expect(
      microsoftButton.querySelector('[data-auth-provider-icon="microsoft"]')
    ).toBeInTheDocument()
    expect(
      googleButton.querySelector('[data-auth-icon-idle="true"]')
    ).toHaveClass("scale-[0.25]", "opacity-0", "blur-[4px]")
    expect(
      googleButton.querySelector('[data-auth-icon-pending="true"]')
    ).toHaveClass("scale-100", "opacity-100", "blur-0")
    expect(
      microsoftButton.querySelector('[data-auth-icon-idle="true"]')
    ).toHaveClass("scale-100", "opacity-100", "blur-0")
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
      "bg-primary",
      "text-primary-foreground"
    )
    expect(magicLinkButton.className).toContain(
      "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary-foreground)_22%"
    )
    expect(magicLinkButton.className).toContain(
      "hover:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary-foreground)_30%"
    )
    expect(magicLinkButton.className).toContain(
      "dark:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary-foreground)_22%"
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
    ).toHaveClass("border-transparent")
    expect(
      container.querySelector('[data-auth-email-input="true"]')
    ).not.toHaveClass("border-destructive")
    expect(
      container.querySelector('[data-auth-email-input="true"]')?.className
    ).toContain("color-mix(in_srgb,var(--destructive)_52%")
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
    ).toHaveClass("border-transparent")
    expect(
      container.querySelector('[data-auth-email-input="true"]')
    ).not.toHaveClass("border-destructive")
    expect(
      container.querySelector('[data-auth-email-input="true"]')?.className
    ).toContain("color-mix(in_srgb,var(--destructive)_52%")
    expect(
      screen.getByRole("button", { name: "Send magic link" })
    ).toBeDisabled()
    expect(requestEmailMagicLinkMock).not.toHaveBeenCalled()
  })

  it("shows the Figma email sending state while requesting a magic link", async () => {
    let resolveMagicLink: (
      value: Awaited<ReturnType<typeof requestEmailMagicLink>>
    ) => void = () => {}

    requestEmailMagicLinkMock.mockReturnValue(
      new Promise((resolve) => {
        resolveMagicLink = resolve
      }) as ReturnType<typeof requestEmailMagicLink>
    )

    render(<LoginAuthFlow />)

    fireEvent.change(screen.getByLabelText("Continue with email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }))

    expect(await screen.findByText("Sending email")).toBeVisible()
    const sendingButton = document.querySelector<HTMLButtonElement>(
      '[data-auth-primary-action="true"]'
    )
    expect(sendingButton).not.toBeNull()
    const sendingButtonElement = sendingButton as HTMLButtonElement
    expect(sendingButtonElement).toBeDisabled()
    expect(sendingButtonElement).toHaveClass(
      "bg-primary",
      "text-primary-foreground"
    )
    expect(
      sendingButtonElement.querySelector('[role="status"]')
    ).toBeInTheDocument()
    expect(screen.queryByText("Sending...")).not.toBeInTheDocument()

    await act(async () => {
      resolveMagicLink({ data: {}, error: null } as never)
    })

    expect(
      await screen.findByRole("button", { name: "Check your email" })
    ).toBeDisabled()
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
    expect(screen.queryByText("Magic link sent")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Continue with email")).toHaveValue(
      "person@example.com"
    )
    expect(screen.getByLabelText("Continue with email")).toBeDisabled()
    expect(screen.getByLabelText("Continue with email")).not.toHaveFocus()
    expect(
      screen.getByRole("button", { name: "Check your email" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByRole("button", { name: "Check your email" })
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Check your email" })
    ).toHaveClass("bg-primary", "text-primary-foreground")
    expect(
      screen
        .getByRole("button", { name: "Check your email" })
        .querySelector('[data-magic-link-icon="true"]')
    ).toBeInTheDocument()
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
      screen.getByRole("button", { name: "Check your email" })
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
    expect(await screen.findByText("Check your email")).toBeVisible()
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

  it("shows callback success only after confirming the current user", async () => {
    confirmCurrentSessionMock.mockResolvedValue({
      data: { user: { id: "user_1" } },
      error: null,
    } as never)

    render(<LoginAuthFlow initialStep="verifying" />)

    expect(
      screen.getByRole("heading", { name: "Completing sign in" })
    ).toBeVisible()
    expect(screen.queryByText("Sign in successful")).not.toBeInTheDocument()

    expect(await screen.findByText("Sign in successful")).toBeVisible()
    expect(confirmCurrentSessionMock).toHaveBeenCalledTimes(1)
  })

  it("returns to sign in when callback success has no confirmed user", async () => {
    confirmCurrentSessionMock.mockResolvedValue({
      data: { user: null },
      error: null,
    } as never)

    render(<LoginAuthFlow initialStep="verifying" />)

    expect(
      await screen.findByRole("button", { name: "Send magic link" })
    ).toBeVisible()
    expect(screen.queryByText("Sign in successful")).not.toBeInTheDocument()
    expect(
      screen.getByText("We couldn't confirm your sign in. Request a new link.")
    ).toBeVisible()
    expect(window.location.pathname).toBe("/login")
    expect(window.location.search).toBe("?error=session_missing")
  })
})
