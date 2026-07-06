"use client"

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react"
import Image from "next/image"
import Link from "next/link"
import { AiMagicIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { LogOut } from "lucide-react"

import {
  requestEmailMagicLink,
  requestOAuthSignIn,
  signOutCurrentSession,
  type OAuthProvider,
} from "@/lib/auth/client"
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
type PendingAction = "send" | "logout" | SocialProvider | null

const SOCIAL_LOGIN_BUTTONS = [
  {
    icon: GoogleIcon,
    provider: "google",
    oauthProvider: "google",
    providerLabel: "Google",
  },
  {
    icon: MicrosoftIcon,
    provider: "microsoft",
    oauthProvider: "azure",
    providerLabel: "Microsoft",
  },
] satisfies Array<{
  icon: ComponentType<ComponentProps<"svg">>
  provider: SocialProvider
  oauthProvider: OAuthProvider
  providerLabel: string
}>

const authSurfaceClass =
  "h-10 rounded-[10px] border-transparent bg-secondary text-secondary-foreground shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/45 dark:bg-[#18191A] dark:text-[#F0ECE6] dark:hover:bg-[#202123] dark:hover:text-[#F0ECE6] dark:focus-visible:border-[#3B3D3F] dark:focus-visible:ring-[#F0ECE6]/25"

const authPrimaryClass =
  "auth-primary-button h-10 rounded-[10px] bg-primary text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/45"

const authTextSecondaryClass = "text-muted-foreground dark:text-[#A8A29E]"

export function LoginAuthFlow({
  initialStep = "email",
  initialFormMessage = null,
  mode = "sign-in",
}: {
  initialStep?: AuthStep
  initialFormMessage?: string | null
  mode?: AuthMode
} = {}) {
  const [step, setStep] = useState<AuthStep>(initialStep)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [email, setEmail] = useState("")
  const [submittedEmail, setSubmittedEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formMessage, setFormMessage] = useState<string | null>(
    initialFormMessage
  )
  const [resendCooldown, setResendCooldown] = useState(0)

  const emailInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (step === "email") {
      emailInputRef.current?.focus()
      return
    }

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
      setEmailError(validationError)
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

    setPendingAction(null)

    if (error) {
      setFormMessage(
        `We couldn't start ${providerLabel} sign-${mode === "sign-up" ? "up" : "in"}. Try again.`
      )
      return
    }

    setFormMessage(`Redirecting to ${providerLabel}...`)
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
      className="min-h-svh bg-background text-foreground dark:bg-[#111111] dark:text-[#F0ECE6]"
      data-auth-shell="true"
    >
      <section
        className={cn(
          "flex min-h-svh justify-center px-4 pb-10",
          step === "success" ? "pt-56 md:pt-[470px]" : "pt-36 md:pt-[336px]"
        )}
      >
        <div
          data-auth-stack="true"
          data-auth-step={step}
          className="flex w-full max-w-96 flex-col items-start gap-6"
        >
          <div
            className={cn(
              "flex w-full flex-col",
              step === "success" ? "gap-4" : "gap-5"
            )}
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
                mode={mode}
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
          {(step === "email" || step === "link") && <TermsCopy mode={mode} />}
        </div>
      </section>
    </main>
  )
}

function AuthHeader({
  children,
  title,
}: {
  children?: ReactNode
  title: string
}) {
  return (
    <div className="flex w-full flex-col items-start gap-6 text-left">
      <div className="relative size-9 shrink-0" data-auth-mark="true">
        <Image
          alt=""
          aria-hidden="true"
          className="size-9 dark:hidden"
          height={36}
          priority
          src="/auth-icon-light.svg"
          width={36}
        />
        <Image
          alt=""
          aria-hidden="true"
          className="hidden size-9 dark:block"
          height={36}
          priority
          src="/auth-icon-dark.svg"
          width={36}
        />
      </div>
      <div className="flex w-full flex-col items-start gap-2">
        <h1 className="text-2xl leading-none font-normal">{title}</h1>
        {children && (
          <div className={cn("text-sm leading-5", authTextSecondaryClass)}>
            {children}
          </div>
        )}
      </div>
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
  mode,
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
  mode: AuthMode
  onEmailChange: (value: string) => void
  onProviderSignIn: (
    provider: OAuthProvider,
    providerId: SocialProvider,
    providerLabel: string
  ) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  pendingAction: PendingAction
}) {
  const actionLabel = mode === "sign-up" ? "Sign up" : "Sign in"
  const isAnyProviderPending =
    pendingAction === "google" || pendingAction === "microsoft"
  const isFormBusy = isSending || isAnyProviderPending

  return (
    <>
      <AuthHeader title={actionLabel}>
        {mode === "sign-up"
          ? "Already have an account? "
          : "Don't have an account? "}
        <Link
          className="font-medium text-signal underline underline-offset-4 hover:text-signal/80 dark:text-[#7DD3FC] dark:hover:text-[#A5E4FF]"
          href={mode === "sign-up" ? "/login" : "/sign-up"}
        >
          {mode === "sign-up" ? "Sign in" : "Sign up"}
        </Link>
      </AuthHeader>
      <form className="flex flex-col gap-6" noValidate onSubmit={onSubmit}>
        <FieldGroup className="gap-2">
          <div className="mb-4 flex flex-col gap-2">
            {SOCIAL_LOGIN_BUTTONS.map((button) => {
              const Icon = button.icon
              const isProviderPending = pendingAction === button.provider
              const label = `${actionLabel} with ${button.providerLabel}`

              return (
                <Button
                  className={cn("w-full", authSurfaceClass)}
                  disabled={isFormBusy}
                  key={button.provider}
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
                  {isProviderPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Icon
                      aria-hidden="true"
                      className="size-4"
                      data-auth-provider-icon={button.provider}
                      data-icon="inline-start"
                    />
                  )}
                  {isProviderPending ? "Redirecting..." : label}
                </Button>
              )
            })}
          </div>
          <Field className="gap-2" data-invalid={!!emailError}>
            <FieldLabel
              className="text-sm leading-5 font-medium text-foreground dark:text-[#F0ECE6]"
              htmlFor="email"
            >
              Or continue with email
            </FieldLabel>
            <InputGroup
              className="rounded-[10px] border-border bg-input shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-ring/45 has-[[data-slot][aria-invalid=true]]:border-destructive dark:border-[#3B3D3F] dark:bg-[#18191A] dark:has-[[data-slot=input-group-control]:focus-visible]:border-[#3B3D3F] dark:has-[[data-slot=input-group-control]:focus-visible]:ring-[#F0ECE6]/25"
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
                className="px-3 text-foreground placeholder:text-muted-foreground disabled:cursor-default disabled:opacity-100 dark:text-[#F0ECE6] dark:placeholder:text-[#777777]"
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
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-transparent bg-secondary px-3 text-sm font-medium whitespace-nowrap text-muted-foreground shadow-none dark:bg-[#18191A] dark:text-[#777777]"
              data-auth-primary-action="true"
              disabled
              type="button"
            >
              <span
                aria-hidden="true"
                data-icon="inline-start"
                data-magic-link-icon="true"
              >
                <HugeiconsIcon icon={AiMagicIcon} size={16} strokeWidth={1.8} />
              </span>
              Magic Link Sent
            </button>
          ) : (
            <Button
              className={cn("w-full", authPrimaryClass)}
              data-auth-primary-action="true"
              disabled={isFormBusy}
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
                    icon={AiMagicIcon}
                    size={16}
                    strokeWidth={1.8}
                  />
                </span>
              )}
              {isSending ? "Sending..." : "Send Magic Link"}
            </Button>
          )}
          {formMessage && (
            <p
              className="text-sm leading-5 text-foreground dark:text-[#F0ECE6]"
              role="alert"
            >
              {formMessage}
            </p>
          )}
        </FieldGroup>
      </form>
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
      <AuthHeader title="Sign in successful" />
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

function GoogleIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M17.64 9.204c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.91c1.702-1.567 2.682-3.874 2.682-6.614Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.182l-2.909-2.258c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.583-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.346l2.582-2.581C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  )
}

function MicrosoftIcon(props: ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect fill="#f25022" height="10" width="10" x="1" y="1" />
      <rect fill="#7fba00" height="10" width="10" x="11" y="1" />
      <rect fill="#00a4ef" height="10" width="10" x="1" y="11" />
      <rect fill="#ffb900" height="10" width="10" x="11" y="11" />
    </svg>
  )
}

function TermsCopy({ mode }: { mode: AuthMode }) {
  return (
    <p
      className={cn(
        "w-full text-center text-xs leading-5",
        authTextSecondaryClass
      )}
      data-auth-terms="true"
    >
      By signing {mode === "sign-up" ? "up" : "in"} you agree to our{" "}
      <a
        className="text-foreground underline underline-offset-4 hover:text-foreground dark:text-[#F0ECE6] dark:hover:text-[#F0ECE6]"
        href="#"
      >
        terms
      </a>
      <br className="hidden md:block" /> and{" "}
      <a
        className="text-foreground underline underline-offset-4 hover:text-foreground dark:text-[#F0ECE6] dark:hover:text-[#F0ECE6]"
        href="#"
      >
        privacy policy
      </a>
    </p>
  )
}
