"use client"

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react"
import Image from "next/image"

import { requestEmailMagicLink, signOutCurrentSession } from "@/lib/auth/client"
import { getEmailValidationError, normalizeEmail } from "@/lib/auth/validation"
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
import { Separator } from "@workspace/ui/components/separator"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

type AuthStep = "email" | "link" | "success"
type PendingAction = "send" | "resend" | "logout" | null

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

const AUTH_THEME_STYLE = {
  "--primary": "oklch(0.922 0 0)",
  "--primary-foreground": "oklch(0.205 0 0)",
  "--ring": "oklch(0.922 0 0)",
} as CSSProperties

export function LoginAuthFlow({
  initialStep = "email",
}: {
  initialStep?: AuthStep
} = {}) {
  const [step, setStep] = useState<AuthStep>(initialStep)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [email, setEmail] = useState("")
  const [submittedEmail, setSubmittedEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
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
  const isResending = pendingAction === "resend"
  const isSigningOut = pendingAction === "logout"

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

    const { error } = await requestEmailMagicLink(nextEmail)

    setPendingAction(null)

    if (error) {
      setEmailError("We couldn't send a sign-in link. Try again in a moment.")
      emailInputRef.current?.focus()
      return
    }

    setSubmittedEmail(nextEmail)
    setStep("link")
  }

  async function handleResend() {
    if (!submittedEmail || resendCooldown > 0) {
      return
    }

    setPendingAction("resend")
    setFormMessage(null)

    const { error } = await requestEmailMagicLink(submittedEmail)

    setPendingAction(null)

    if (error) {
      setFormMessage("We couldn't resend the link. Try again shortly.")
      return
    }

    setResendCooldown(30)
    setFormMessage("A new sign-in link was sent.")
  }

  function handleUseAnotherEmail() {
    setSubmittedEmail("")
    setFormMessage(null)
    setResendCooldown(0)
    setStep("email")
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
    setEmailError(null)
    setStep("email")
  }

  return (
    <main
      className="dark min-h-svh bg-muted text-foreground"
      style={AUTH_THEME_STYLE}
    >
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
            {step === "link" && (
              <MagicLinkStep
                formMessage={formMessage}
                isResending={isResending}
                resendCooldown={resendCooldown}
                onResend={handleResend}
                onUseAnotherEmail={handleUseAnotherEmail}
                submittedEmail={submittedEmail}
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
      <Image
        alt=""
        aria-hidden="true"
        className="size-6 shrink-0"
        height={24}
        priority
        src="/backdesk-mark.png"
        width={24}
      />
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

function MagicLinkStep({
  formMessage,
  isResending,
  onResend,
  onUseAnotherEmail,
  resendCooldown,
  submittedEmail,
}: {
  formMessage: string | null
  isResending: boolean
  onResend: () => void
  onUseAnotherEmail: () => void
  resendCooldown: number
  submittedEmail: string
}) {
  const resendDisabled = isResending || resendCooldown > 0

  return (
    <>
      <CardHeader className="items-center px-6 pt-6 pb-5 text-center">
        <CardTitle className="text-xl leading-tight font-semibold">
          Check your email
        </CardTitle>
        <CardDescription>
          We sent a sign-in link to {submittedEmail}.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <FieldGroup className="gap-6">
          <Field>
            <FieldDescription className="text-center">
              Open the link from this device to finish signing in.
            </FieldDescription>
            {formMessage && (
              <FieldDescription className="text-center text-foreground">
                {formMessage}
              </FieldDescription>
            )}
          </Field>
          <div className="flex flex-col gap-3">
            <Button
              className="w-full"
              disabled={resendDisabled}
              onClick={onResend}
              type="button"
              variant="outline"
            >
              {isResending && <Spinner data-icon="inline-start" />}
              {isResending
                ? "Resending..."
                : resendCooldown > 0
                  ? `Resend in ${resendCooldown}s`
                  : "Resend link"}
            </Button>
            <Button
              className="w-full"
              onClick={onUseAnotherEmail}
              type="button"
              variant="link"
            >
              Use another email
            </Button>
          </div>
        </FieldGroup>
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
      <a
        className="underline underline-offset-4 hover:text-foreground"
        href="#"
      >
        Terms of Service
      </a>{" "}
      and{" "}
      <a
        className="underline underline-offset-4 hover:text-foreground"
        href="#"
      >
        Privacy Policy
      </a>
    </p>
  )
}
