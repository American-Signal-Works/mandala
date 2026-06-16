import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { LoginAuthFlow } from "./LoginAuthFlow"
import {
  requestEmailOtp,
  signOutCurrentSession,
  verifyEmailOtp,
} from "@/lib/auth/client"

vi.mock("@/lib/auth/client", () => ({
  requestEmailOtp: vi.fn(),
  signOutCurrentSession: vi.fn(),
  verifyEmailOtp: vi.fn(),
}))

const requestEmailOtpMock = vi.mocked(requestEmailOtp)
const verifyEmailOtpMock = vi.mocked(verifyEmailOtp)
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
    requestEmailOtpMock.mockReset()
    verifyEmailOtpMock.mockReset()
    signOutCurrentSessionMock.mockReset()
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

    expect(requestEmailOtpMock).not.toHaveBeenCalled()
  })

  it("validates email before sending an OTP", async () => {
    render(<LoginAuthFlow />)

    fireEvent.click(screen.getByRole("button", { name: "Login" }))

    expect(await screen.findByText("Enter your email address.")).toBeVisible()
    expect(requestEmailOtpMock).not.toHaveBeenCalled()
  })

  it("sends a normalized email and advances to OTP entry", async () => {
    requestEmailOtpMock.mockResolvedValue({ data: {}, error: null } as never)

    render(<LoginAuthFlow />)

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "  PERSON@Example.COM " },
    })
    fireEvent.click(screen.getByRole("button", { name: "Login" }))

    await waitFor(() => {
      expect(requestEmailOtpMock).toHaveBeenCalledWith("person@example.com")
    })
    expect(await screen.findByText("Enter verification code")).toBeVisible()
  })

  it("verifies a six-digit OTP, shows success, and logs out back to sign in", async () => {
    requestEmailOtpMock.mockResolvedValue({ data: {}, error: null } as never)
    verifyEmailOtpMock.mockResolvedValue({ data: {}, error: null } as never)
    signOutCurrentSessionMock.mockResolvedValue({ error: null } as never)

    const { container } = render(<LoginAuthFlow />)

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Login" }))

    await screen.findByText("Enter verification code")

    const otpInput = container.querySelector(
      'input[autocomplete="one-time-code"]'
    ) as HTMLInputElement
    expect(otpInput).toBeTruthy()

    fireEvent.change(otpInput, { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Verify" }))

    await waitFor(() => {
      expect(verifyEmailOtpMock).toHaveBeenCalledWith(
        "person@example.com",
        "123456"
      )
    })
    expect(await screen.findByText("Login successful")).toBeVisible()

    fireEvent.click(screen.getByRole("button", { name: "Logout" }))

    await waitFor(() => {
      expect(signOutCurrentSessionMock).toHaveBeenCalled()
    })
    expect(await screen.findByRole("button", { name: "Login" })).toBeVisible()
  })

  it("keeps users on OTP entry after invalid verification", async () => {
    requestEmailOtpMock.mockResolvedValue({ data: {}, error: null } as never)
    verifyEmailOtpMock.mockResolvedValue({
      data: {},
      error: { message: "Token has expired" },
    } as never)

    const { container } = render(<LoginAuthFlow />)

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "person@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Login" }))

    await screen.findByText("Enter verification code")

    const otpInput = container.querySelector(
      'input[autocomplete="one-time-code"]'
    ) as HTMLInputElement
    fireEvent.change(otpInput, { target: { value: "123456" } })
    fireEvent.click(screen.getByRole("button", { name: "Verify" }))

    expect(
      await screen.findByText(
        "That code is invalid or expired. Request a new code and try again."
      )
    ).toBeVisible()
    expect(screen.getByText("Enter verification code")).toBeVisible()
  })
})
