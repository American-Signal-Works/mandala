"use client"

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react"
import Image from "next/image"
import { Mail02Icon, MailOpen02Icon } from "@hugeicons/core-free-icons"
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
  "h-10 rounded-[10px] border-transparent bg-secondary text-secondary-foreground shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/45"

const authPrimaryClass =
  "auth-primary-button h-10 rounded-[10px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/45"

const authTextSecondaryClass = "text-muted-foreground"
const authErrorClass = "text-destructive"

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
      className="min-h-svh bg-background text-foreground"
      data-auth-shell="true"
    >
      <section
        className="flex min-h-svh w-full overflow-hidden bg-background"
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
        className="size-10 dark:hidden"
        height={40}
        priority
        src="/auth-icon-light.svg"
        width={40}
      />
      <Image
        alt=""
        aria-hidden="true"
        className="hidden size-10 dark:block"
        height={40}
        priority
        src="/auth-icon-dark.svg"
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
        className="object-cover opacity-[0.03] outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
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
      <h1 className="text-2xl leading-none font-medium text-balance">
        {title ?? "Welcome to Mandala"}
      </h1>
      {!title && (
        <p
          className={cn(
            "text-sm leading-5 text-pretty",
            authTextSecondaryClass
          )}
        >
          Sign in or make an account
        </p>
      )}
    </div>
  )
}

function AuthIconTransition({
  idleIcon,
  isPending,
}: {
  idleIcon: ReactNode
  isPending: boolean
}) {
  return (
    <span
      className="relative inline-flex size-4 shrink-0 items-center justify-center"
      data-auth-icon-transition="true"
      data-icon="inline-start"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
          isPending
            ? "scale-[0.25] opacity-0 blur-[4px]"
            : "blur-0 scale-100 opacity-100"
        )}
        data-auth-icon-idle="true"
      >
        {idleIcon}
      </span>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
          isPending
            ? "blur-0 scale-100 opacity-100"
            : "scale-[0.25] opacity-0 blur-[4px]"
        )}
        data-auth-icon-pending="true"
      >
        <Spinner
          aria-hidden={!isPending}
          role={isPending ? "status" : undefined}
        />
      </span>
    </span>
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
                emailError ? authErrorClass : "text-foreground"
              )}
              htmlFor="email"
            >
              {emailError ?? "Continue with email"}
            </FieldLabel>
            <InputGroup
              className={cn(
                "rounded-[10px] border-border bg-input shadow-none transition-[border-color,box-shadow] duration-150 ease-out has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-ring/45",
                emailError &&
                  "border-destructive has-[[data-slot=input-group-control]:focus-visible]:border-destructive has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-0"
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
                className="px-3 text-foreground placeholder:text-muted-foreground disabled:cursor-default disabled:opacity-100"
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
            <Button
              aria-disabled="true"
              className={cn("w-full", authPrimaryClass)}
              data-auth-primary-action="true"
              disabled
              type="button"
            >
              <span
                aria-hidden="true"
                data-icon="inline-start"
                data-magic-link-icon="true"
              >
                <HugeiconsIcon
                  icon={MailOpen02Icon}
                  size={16}
                  strokeWidth={1.8}
                />
              </span>
              Check your email
            </Button>
          ) : (
            <Button
              className={cn("w-full", authPrimaryClass)}
              data-auth-primary-action="true"
              disabled={isFormBusy || !!emailError}
              type="submit"
            >
              <AuthIconTransition
                isPending={isSending}
                idleIcon={
                  <span
                    aria-hidden="true"
                    className="flex size-4 items-center justify-center"
                    data-magic-link-icon="true"
                  >
                    <HugeiconsIcon
                      icon={Mail02Icon}
                      size={16}
                      strokeWidth={1.8}
                    />
                  </span>
                }
              />
              {isSending ? "Sending email" : "Send magic link"}
            </Button>
          )}
          {formMessage && (
            <p
              className="text-sm leading-5 text-pretty text-foreground"
              role="alert"
            >
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
          <AuthIconTransition
            isPending={isSigningOut}
            idleIcon={
              <LogOut aria-hidden="true" className="size-4" size={16} />
            }
          />
          {isSigningOut ? "Signing out..." : "Sign out"}
        </Button>
        {formMessage && (
          <p
            className="text-center text-sm text-pretty text-destructive"
            role="alert"
          >
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
      <AuthIconTransition
        isPending={isPending}
        idleIcon={
          <Image
            alt=""
            aria-hidden="true"
            className="size-4"
            data-auth-provider-icon={button.provider}
            height={16}
            src={button.iconSrc}
            width={16}
          />
        }
      />
      {isPending && <span className="sr-only">Redirecting...</span>}
    </Button>
  )
}

function TermsCopy() {
  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-center justify-center gap-1 px-0 text-center text-sm leading-5 text-pretty sm:px-16",
        authTextSecondaryClass
      )}
      data-auth-terms="true"
    >
      <a
        className="inline-flex min-h-10 items-center rounded-sm px-1 text-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:outline-none"
        href="#"
      >
        Terms
      </a>{" "}
      <span>and</span>{" "}
      <a
        className="inline-flex min-h-10 items-center rounded-sm px-1 text-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/45 focus-visible:outline-none"
        href="#"
      >
        Privacy Policy
      </a>
    </div>
  )
}
