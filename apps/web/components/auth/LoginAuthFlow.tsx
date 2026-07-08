"use client"

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react"
import Image from "next/image"
import { Mail02Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LogOut } from "lucide-react"

import {
  requestEmailMagicLink,
  requestOAuthSignIn,
  signOutCurrentSession,
  type OAuthProvider,
} from "@/lib/auth/client"
import type { AuthCallbackPendingAction } from "@/lib/auth/callback"
import { getEmailValidationError, normalizeEmail } from "@/lib/auth/validation"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

type AuthStep = "email" | "link" | "success"
type AuthMode = "sign-in" | "sign-up"
type SocialProvider = "google" | "microsoft"
type PendingAction = AuthCallbackPendingAction | "logout" | null
type SocialLoginButtonConfig = {
  iconSrc: string
  provider: SocialProvider
  oauthProvider: OAuthProvider
  providerLabel: string
}

const SOCIAL_LOGIN_BUTTONS = [
  {
    iconSrc: "/auth-provider-google.svg",
    provider: "google",
    oauthProvider: "google",
    providerLabel: "Google",
  },
  {
    iconSrc: "/auth-provider-microsoft.svg",
    provider: "microsoft",
    oauthProvider: "azure",
    providerLabel: "Microsoft",
  },
] satisfies SocialLoginButtonConfig[]

const authSurfaceClass =
  "h-9 rounded-[10px] border-transparent bg-[#2c2e30] text-[#f8f8f9] shadow-none hover:bg-[#35383a] hover:text-[#f8f8f9] focus-visible:border-[#45484a] focus-visible:ring-[#f0ece3]/25"

const authPrimaryClass =
  "auth-primary-button h-10 rounded-[10px] bg-[#4b60ff] text-[#f8f8f9] shadow-none hover:bg-[#4054f4] hover:text-[#f8f8f9] focus-visible:border-[#6f7cff] focus-visible:ring-[#f0ece3]/25"

const authTextSecondaryClass = "text-[#cbced0]"
const authErrorClass = "text-[#e55767]"

function getAuthEmailErrorMessage(validationError: string) {
  if (validationError === "Enter your email address.") {
    return "Please enter your email"
  }

  if (validationError === "Enter a valid email address.") {
    return "Invalid email"
  }

  return validationError
}

export function LoginAuthFlow({
  initialStep = "email",
  initialFormMessage = null,
  initialPendingAction = null,
  mode = "sign-in",
}: {
  initialStep?: AuthStep
  initialFormMessage?: string | null
  initialPendingAction?: AuthCallbackPendingAction | null
  mode?: AuthMode
} = {}) {
  const [step, setStep] = useState<AuthStep>(initialStep)
  const [pendingAction, setPendingAction] =
    useState<PendingAction>(initialPendingAction)
  const [email, setEmail] = useState("")
  const [submittedEmail, setSubmittedEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formMessage, setFormMessage] = useState<string | null>(
    initialFormMessage
  )
  const [resendCooldown, setResendCooldown] = useState(0)

  const emailInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === "link") {
      emailInputRef.current?.blur()
    }
  }, [step])

  useEffect(() => {
    if (resendCooldown <= 0) {
      return
    }

    const timeout = window.setTimeout(() => {
      setResendCooldown(0)
    }, resendCooldown * 1000)

    return () => window.clearTimeout(timeout)
  }, [resendCooldown])

  const isSending = pendingAction === "send"
  const isSigningOut = pendingAction === "logout"

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const validationError = getEmailValidationError(email)
    if (validationError) {
      setEmailError(getAuthEmailErrorMessage(validationError))
      setFormMessage(null)
      emailInputRef.current?.focus()
      return
    }

    const nextEmail = normalizeEmail(email)

    setPendingAction("send")
    setEmailError(null)
    setFormMessage(null)

    const { error } = await requestEmailMagicLink(nextEmail, {
      shouldCreateUser: mode === "sign-up",
    })

    setPendingAction(null)

    if (error) {
      setEmailError("We couldn't send a magic link. Try again in a moment.")
      emailInputRef.current?.focus()
      return
    }

    setSubmittedEmail(nextEmail)
    setEmail(nextEmail)
    setResendCooldown(30)
    emailInputRef.current?.blur()
    setStep("link")
  }

  async function handleProviderSignIn(
    provider: OAuthProvider,
    providerId: SocialProvider,
    providerLabel: string
  ) {
    setPendingAction(providerId)
    setEmailError(null)
    setFormMessage(null)

    const { error } = await requestOAuthSignIn(provider)

    if (error) {
      setPendingAction(null)
      setFormMessage(
        `We couldn't start ${providerLabel} sign-${mode === "sign-up" ? "up" : "in"}. Try again.`
      )
      return
    }

    setFormMessage(null)
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
    window.history.replaceState(null, "", "/login")
    setStep("email")
  }

  return (
    <main
      className="min-h-svh bg-[#151617] text-[#f0ece3]"
      data-auth-shell="true"
    >
      <section
        className="flex min-h-svh w-full overflow-hidden bg-[#151617]"
        data-auth-frame="true"
      >
        <AuthVisual />
        <div
          className="flex min-h-svh w-full flex-col justify-between gap-10 px-6 py-10 md:w-[560px] md:shrink-0 md:px-16 md:py-24"
          data-auth-panel="true"
        >
          <AuthMark />
          <div
            data-auth-stack="true"
            data-auth-step={step}
            className="flex w-full max-w-[432px] flex-col items-start gap-6"
          >
            {(step === "email" || step === "link") && (
              <EmailStep
                email={
                  step === "link" && resendCooldown > 0 ? submittedEmail : email
                }
                emailError={emailError}
                formMessage={formMessage}
                isMagicLinkSent={step === "link" && resendCooldown > 0}
                isSending={isSending}
                onEmailChange={(value) => {
                  setEmail(value)
                  setEmailError(null)
                  setFormMessage(null)
                }}
                onProviderSignIn={handleProviderSignIn}
                onSubmit={handleEmailSubmit}
                pendingAction={pendingAction}
                inputRef={emailInputRef}
              />
            )}
            {step === "success" && (
              <SuccessStep
                formMessage={formMessage}
                isSigningOut={isSigningOut}
                onLogout={handleLogout}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

function AuthMark() {
  return (
    <div className="relative size-10 shrink-0" data-auth-mark="true">
      <Image
        alt=""
        aria-hidden="true"
        className="size-10"
        height={40}
        priority
        src="/auth-icon-mandala-dark.svg"
        width={40}
      />
    </div>
  )
}

function AuthVisual() {
  return (
    <div
      className="relative hidden min-h-svh min-w-0 flex-1 overflow-hidden md:block"
      data-auth-visual="true"
    >
      <Image
        alt=""
        aria-hidden="true"
        className="object-cover opacity-[0.03]"
        fill
        priority
        src="/auth-visual-dark.jpg"
      />
    </div>
  )
}

function AuthIntro({ title }: { title?: string }) {
  return (
    <div className="flex w-full flex-col items-start gap-1 text-left">
      <h1 className="text-2xl leading-none font-medium">
        {title ?? "Welcome to Mandala"}
      </h1>
      {!title && (
        <p className={cn("text-sm leading-5", authTextSecondaryClass)}>
          Sign in or make an account
        </p>
      )}
    </div>
  )
}

function EmailStep({
  email,
  emailError,
  formMessage,
  inputRef,
  isMagicLinkSent,
  isSending,
  onEmailChange,
  onProviderSignIn,
  onSubmit,
  pendingAction,
}: {
  email: string
  emailError: string | null
  formMessage: string | null
  inputRef: RefObject<HTMLInputElement | null>
  isMagicLinkSent: boolean
  isSending: boolean
  onEmailChange: (value: string) => void
  onProviderSignIn: (
    provider: OAuthProvider,
    providerId: SocialProvider,
    providerLabel: string
  ) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pendingAction: PendingAction
}) {
  const isAnyProviderPending =
    pendingAction === "google" || pendingAction === "microsoft"
  const isFormBusy = isSending || isAnyProviderPending

  return (
    <>
      <AuthIntro />
      <div className="flex w-full gap-2" data-auth-provider-row="true">
        {SOCIAL_LOGIN_BUTTONS.map((button) => (
          <ProviderSignInButton
            button={button}
            disabled={isFormBusy}
            isPending={pendingAction === button.provider}
            key={button.provider}
            onProviderSignIn={onProviderSignIn}
          />
        ))}
      </div>
      <form
        className="flex w-full flex-col gap-6"
        noValidate
        onSubmit={onSubmit}
      >
        <FieldGroup className="gap-2">
          <Field className="gap-2" data-invalid={!!emailError}>
            <FieldLabel
              className={cn(
                "text-sm leading-5 font-medium",
                emailError ? authErrorClass : "text-[#f8f8f9]"
              )}
              htmlFor="email"
            >
              {emailError ?? "Continue with email"}
            </FieldLabel>
            <InputGroup
              className={cn(
                "rounded-[10px] border-[#45484a] bg-[#2c2e30] shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-[#6b7074] has-[[data-slot=input-group-control]:focus-visible]:ring-[#f0ece3]/25",
                emailError &&
                  "border-[#e55767] has-[[data-slot=input-group-control]:focus-visible]:border-[#e55767] has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot][aria-invalid=true]]:border-[#e55767] has-[[data-slot][aria-invalid=true]]:ring-0"
              )}
              data-auth-email-input="true"
            >
              <InputGroupInput
                key={isMagicLinkSent ? "sent-email" : "email"}
                ref={inputRef}
                aria-invalid={!!emailError}
                aria-describedby={
                  emailError ? "email-error" : "email-description"
                }
                autoComplete="email"
                className="px-3 text-[#f0ece3] placeholder:text-[#cbced0] disabled:cursor-default disabled:opacity-100"
                disabled={isFormBusy || isMagicLinkSent}
                id="email"
                inputMode="email"
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="user@example.com"
                type="email"
                value={email}
              />
            </InputGroup>
            {emailError ? (
              <span hidden id="email-error">
                {emailError}
              </span>
            ) : (
              <span hidden id="email-description">
                A link will be sent to you
              </span>
            )}
          </Field>
          {isMagicLinkSent ? (
            <button
              aria-disabled="true"
              className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] border border-transparent bg-[#2c2e30] px-2.5 py-2 text-sm font-medium whitespace-nowrap text-[#cbced0] shadow-none"
              data-auth-primary-action="true"
              disabled
              type="button"
            >
              <span
                aria-hidden="true"
                data-icon="inline-start"
                data-magic-link-icon="true"
              >
                <HugeiconsIcon icon={Mail02Icon} size={16} strokeWidth={1.8} />
              </span>
              Magic link sent
            </button>
          ) : (
            <Button
              className={cn("w-full", authPrimaryClass)}
              data-auth-primary-action="true"
              disabled={isFormBusy || !!emailError}
              type="submit"
            >
              {isSending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <span
                  aria-hidden="true"
                  data-icon="inline-start"
                  data-magic-link-icon="true"
                >
                  <HugeiconsIcon
                    icon={Mail02Icon}
                    size={16}
                    strokeWidth={1.8}
                  />
                </span>
              )}
              {isSending ? "Sending..." : "Send magic link"}
            </Button>
          )}
          {formMessage && (
            <p className="text-sm leading-5 text-[#f0ece3]" role="alert">
              {formMessage}
            </p>
          )}
        </FieldGroup>
      </form>
      <TermsCopy />
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
      <AuthIntro title="Sign in successful" />
      <div className="flex flex-col gap-3">
        <Button
          className={cn("w-full", authPrimaryClass)}
          disabled={isSigningOut}
          onClick={onLogout}
          type="button"
        >
          {isSigningOut ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <LogOut aria-hidden="true" data-icon="inline-start" size={16} />
          )}
          {isSigningOut ? "Signing out..." : "Sign out"}
        </Button>
        {formMessage && (
          <p className="text-center text-sm text-destructive" role="alert">
            {formMessage}
          </p>
        )}
      </div>
    </>
  )
}

function ProviderSignInButton({
  button,
  disabled,
  isPending,
  onProviderSignIn,
}: {
  button: SocialLoginButtonConfig
  disabled: boolean
  isPending: boolean
  onProviderSignIn: (
    provider: OAuthProvider,
    providerId: SocialProvider,
    providerLabel: string
  ) => void
}) {
  const label = `Sign in with ${button.providerLabel}`

  return (
    <Button
      aria-label={label}
      className={cn("flex-1 px-0", authSurfaceClass)}
      disabled={disabled}
      onClick={() =>
        onProviderSignIn(
          button.oauthProvider,
          button.provider,
          button.providerLabel
        )
      }
      title={label}
      type="button"
      variant="outline"
    >
      {isPending ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <Image
          alt=""
          aria-hidden="true"
          className="size-4"
          data-auth-provider-icon={button.provider}
          data-icon="inline-start"
          height={16}
          src={button.iconSrc}
          width={16}
        />
      )}
      {isPending && <span className="sr-only">Redirecting...</span>}
    </Button>
  )
}

function TermsCopy() {
  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center justify-center gap-1 px-0 text-center text-sm leading-5 sm:px-16",
        authTextSecondaryClass
      )}
      data-auth-terms="true"
    >
      <a
        className="text-[#f8f8f9] underline underline-offset-4 hover:text-[#f8f8f9]"
        href="#"
      >
        Terms
      </a>{" "}
      <span>and</span>{" "}
      <a
        className="text-[#f8f8f9] underline underline-offset-4 hover:text-[#f8f8f9]"
        href="#"
      >
        Privacy Policy
      </a>
    </div>
  )
}
