"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { GalleryVerticalEnd } from "lucide-react"

import {
  requestEmailOtp,
  signOutCurrentSession,
  verifyEmailOtp,
} from "@/lib/auth/client"
import {
  getEmailValidationError,
  getOtpValidationError,
  normalizeEmail,
  normalizeOtp,
} from "@/lib/auth/validation"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp"
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

type AuthStep = "email" | "otp" | "success"
type PendingAction = "send" | "verify" | "resend" | "logout" | null

const OTP_SLOT_INDEXES = [0, 1, 2, 3, 4, 5]
const SOCIAL_LOGIN_BUTTONS = [
  {
    label: "Login with Google",
    title: "Google login is not available yet",
  },
  {
    label: "Login with Microsoft",
    title: "Microsoft login is not available yet",
  },
]

export function LoginAuthFlow() {
  const [step, setStep] = useState<AuthStep>("email")
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [email, setEmail] = useState("")
  const [submittedEmail, setSubmittedEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [otpError, setOtpError] = useState<string | null>(null)
  const [formMessage, setFormMessage] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  const emailInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === "email") {
      emailInputRef.current?.focus()
    }
  }, [step])

  useEffect(() => {
    if (resendCooldown <= 0) {
      return
    }

    const timeout = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearTimeout(timeout)
  }, [resendCooldown])

  const isSending = pendingAction === "send"
  const isVerifying = pendingAction === "verify"
  const isResending = pendingAction === "resend"
  const isSigningOut = pendingAction === "logout"
  const canVerify = otp.length === 6 && !isVerifying

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const validationError = getEmailValidationError(email)
    if (validationError) {
      setEmailError(validationError)
      setFormMessage(null)
      emailInputRef.current?.focus()
      return
    }

    const nextEmail = normalizeEmail(email)

    setPendingAction("send")
    setEmailError(null)
    setFormMessage(null)

    const { error } = await requestEmailOtp(nextEmail)

    setPendingAction(null)

    if (error) {
      setEmailError("We couldn't send a code. Try again in a moment.")
      emailInputRef.current?.focus()
      return
    }

    setSubmittedEmail(nextEmail)
    setOtp("")
    setOtpError(null)
    setStep("otp")
  }

  async function handleVerifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const validationError = getOtpValidationError(otp)
    if (validationError) {
      setOtpError(validationError)
      setFormMessage(null)
      return
    }

    setPendingAction("verify")
    setOtpError(null)
    setFormMessage(null)

    const { error } = await verifyEmailOtp(submittedEmail, otp)

    setPendingAction(null)

    if (error) {
      setOtpError("That code is invalid or expired. Request a new code and try again.")
      return
    }

    setOtp("")
    setStep("success")
  }

  async function handleResend() {
    if (!submittedEmail || resendCooldown > 0) {
      return
    }

    setPendingAction("resend")
    setOtpError(null)
    setFormMessage(null)

    const { error } = await requestEmailOtp(submittedEmail)

    setPendingAction(null)

    if (error) {
      setOtpError("We couldn't resend a code. Try again shortly.")
      return
    }

    setOtp("")
    setResendCooldown(30)
    setFormMessage("A new code was sent.")
  }

  async function handleLogout() {
    setPendingAction("logout")
    setFormMessage(null)

    const { error } = await signOutCurrentSession()

    setPendingAction(null)

    if (error) {
      setFormMessage("We couldn't sign you out. Try again.")
      return
    }

    setSubmittedEmail("")
    setEmail("")
    setOtp("")
    setEmailError(null)
    setOtpError(null)
    setStep("email")
  }

  return (
    <main className="dark min-h-svh bg-muted text-foreground">
      <section className="flex min-h-svh items-center justify-center px-4 py-10">
        <div className="flex w-full flex-col items-center gap-6">
          <BrandMark />
          <AuthCard step={step}>
            {step === "email" && (
              <EmailStep
                email={email}
                emailError={emailError}
                isSending={isSending}
                onEmailChange={(value) => {
                  setEmail(value)
                  setEmailError(null)
                }}
                onSubmit={handleEmailSubmit}
                inputRef={emailInputRef}
              />
            )}
            {step === "otp" && (
              <OtpStep
                canVerify={canVerify}
                formMessage={formMessage}
                isResending={isResending}
                isVerifying={isVerifying}
                otp={otp}
                otpError={otpError}
                resendCooldown={resendCooldown}
                onChangeOtp={(value) => {
                  setOtp(normalizeOtp(value))
                  setOtpError(null)
                }}
                onResend={handleResend}
                onSubmit={handleVerifySubmit}
              />
            )}
            {step === "success" && (
              <SuccessStep
                formMessage={formMessage}
                isSigningOut={isSigningOut}
                onLogout={handleLogout}
              />
            )}
          </AuthCard>
          {step === "email" && <TermsCopy />}
        </div>
      </section>
    </main>
  )
}

function BrandMark() {
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <GalleryVerticalEnd aria-hidden="true" data-icon="inline-start" />
      </span>
      Backdesk
    </div>
  )
}

function AuthCard({
  children,
  step,
}: {
  children: React.ReactNode
  step: AuthStep
}) {
  return (
    <Card
      className={cn(
        "w-full gap-0 rounded-lg border border-border/70 bg-background py-0 shadow-none ring-0",
        step === "email" ? "max-w-sm" : "max-w-xs"
      )}
    >
      {children}
    </Card>
  )
}

function EmailStep({
  email,
  emailError,
  inputRef,
  isSending,
  onEmailChange,
  onSubmit,
}: {
  email: string
  emailError: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  isSending: boolean
  onEmailChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <>
      <CardHeader className="items-center px-6 pt-6 pb-5 text-center">
        <CardTitle className="text-xl leading-tight font-semibold">
          Welcome back
        </CardTitle>
        <CardDescription>
          Login with your Google or Microsoft account
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <form className="flex flex-col gap-6" noValidate onSubmit={onSubmit}>
          <FieldGroup className="gap-4">
            <div className="flex flex-col gap-3">
              {SOCIAL_LOGIN_BUTTONS.map((button) => (
                <Button
                  aria-disabled="true"
                  className="w-full"
                  key={button.label}
                  onClick={(event) => event.preventDefault()}
                  title={button.title}
                  type="button"
                  variant="outline"
                >
                  {button.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" />
              <span>Or continue with</span>
              <Separator className="flex-1" />
            </div>
            <Field data-invalid={!!emailError}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                ref={inputRef}
                aria-invalid={!!emailError}
                autoComplete="email"
                disabled={isSending}
                id="email"
                inputMode="email"
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="m@example.com"
                type="email"
                value={email}
              />
              <FieldError>{emailError}</FieldError>
            </Field>
            <Button className="w-full" disabled={isSending} type="submit">
              {isSending && <Spinner data-icon="inline-start" />}
              {isSending ? "Sending..." : "Login"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </>
  )
}

function OtpStep({
  canVerify,
  formMessage,
  isResending,
  isVerifying,
  onChangeOtp,
  onResend,
  onSubmit,
  otp,
  otpError,
  resendCooldown,
}: {
  canVerify: boolean
  formMessage: string | null
  isResending: boolean
  isVerifying: boolean
  onChangeOtp: (value: string) => void
  onResend: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  otp: string
  otpError: string | null
  resendCooldown: number
}) {
  const resendDisabled = isResending || resendCooldown > 0

  return (
    <>
      <CardHeader className="items-center px-6 pt-6 pb-5 text-center">
        <CardTitle className="text-xl leading-tight font-semibold">
          Enter verification code
        </CardTitle>
        <CardDescription>
          We sent a 6-digit code to your email.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <form className="flex flex-col gap-6" noValidate onSubmit={onSubmit}>
          <FieldGroup className="gap-6">
            <Field data-invalid={!!otpError}>
              <FieldLabel className="sr-only" htmlFor="verification-code">
                Verification code
              </FieldLabel>
              <InputOTP
                aria-invalid={!!otpError}
                autoComplete="one-time-code"
                autoFocus
                containerClassName="justify-center"
                disabled={isVerifying}
                id="verification-code"
                inputMode="numeric"
                maxLength={6}
                onChange={onChangeOtp}
                value={otp}
              >
                <InputOTPGroup className="gap-2 rounded-none">
                  {OTP_SLOT_INDEXES.map((index) => (
                    <InputOTPSlot
                      className="size-8 rounded-md border-l text-base"
                      index={index}
                      key={index}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <FieldDescription className="text-center">
                Enter the 6-digit code sent to your email.
              </FieldDescription>
              <FieldError className="text-center">{otpError}</FieldError>
              {formMessage && !otpError && (
                <FieldDescription className="text-center text-foreground">
                  {formMessage}
                </FieldDescription>
              )}
            </Field>
            <Button
              className="w-full"
              disabled={!canVerify}
              type="submit"
            >
              {isVerifying && <Spinner data-icon="inline-start" />}
              {isVerifying ? "Verifying..." : "Verify"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Didn&apos;t receive the code?{" "}
              <Button
                className="h-auto p-0 align-baseline text-muted-foreground underline disabled:opacity-60"
                disabled={resendDisabled}
                onClick={onResend}
                type="button"
                variant="link"
              >
                {isResending && <Spinner data-icon="inline-start" />}
                {isResending
                  ? "Resending..."
                  : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : "Resend"}
              </Button>
            </p>
          </FieldGroup>
        </form>
      </CardContent>
    </>
  )
}

function SuccessStep({
  formMessage,
  isSigningOut,
  onLogout,
}: {
  formMessage: string | null
  isSigningOut: boolean
  onLogout: () => void
}) {
  return (
    <>
      <CardHeader className="items-center px-6 pt-7 pb-6 text-center">
        <CardTitle className="text-xl leading-tight font-semibold">
          Login successful
        </CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <div className="flex flex-col gap-3">
          <Button
            className="w-full"
            disabled={isSigningOut}
            onClick={onLogout}
            type="button"
          >
            {isSigningOut && <Spinner data-icon="inline-start" />}
            {isSigningOut ? "Logging out..." : "Logout"}
          </Button>
          {formMessage && (
            <p className="text-center text-sm text-destructive" role="alert">
              {formMessage}
            </p>
          )}
        </div>
      </CardContent>
    </>
  )
}

function TermsCopy() {
  return (
    <p className="max-w-[20rem] text-center text-xs leading-5 text-muted-foreground">
      By clicking continue, you agree to our{" "}
      <a className="underline underline-offset-4 hover:text-foreground" href="#">
        Terms of Service
      </a>{" "}
      and{" "}
      <a className="underline underline-offset-4 hover:text-foreground" href="#">
        Privacy Policy
      </a>
    </p>
  )
}
