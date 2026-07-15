export type AuthCallbackMethod = "email" | "google" | "microsoft"
export type AuthCallbackPendingAction = "send" | "google" | "microsoft"

export const AUTH_CALLBACK_FAILURES = [
  "missing",
  "malformed",
  "expired",
  "replayed",
  "provider_failed",
  "session_replacement_required",
] as const

export type AuthCallbackFailure = (typeof AUTH_CALLBACK_FAILURES)[number]

export type AuthCallbackCredential =
  | { kind: "code"; value: string }
  | { kind: "otp"; value: string; type: "email" | "signup" }

export type ParsedAuthCallback =
  | {
      ok: true
      credential: AuthCallbackCredential
    }
  | {
      ok: false
      failure: AuthCallbackFailure
    }

const MAX_AUTH_CREDENTIAL_LENGTH = 8_192

export function parseAuthCallback(url: URL): ParsedAuthCallback {
  if (url.searchParams.has("error") || url.searchParams.has("error_code")) {
    return { ok: false, failure: "provider_failed" }
  }

  const code = url.searchParams.get("code")
  const tokenHash = url.searchParams.get("token_hash")

  if (!code && !tokenHash) {
    return { ok: false, failure: "missing" }
  }

  if (code && tokenHash) {
    return { ok: false, failure: "malformed" }
  }

  if (code) {
    return isValidCredential(code)
      ? { ok: true, credential: { kind: "code", value: code } }
      : { ok: false, failure: "malformed" }
  }

  const type = url.searchParams.get("type") ?? "email"
  if (
    !tokenHash ||
    !isValidCredential(tokenHash) ||
    (type !== "email" && type !== "signup")
  ) {
    return { ok: false, failure: "malformed" }
  }

  return {
    ok: true,
    credential: { kind: "otp", value: tokenHash, type },
  }
}

export function classifyAuthCallbackError(error: unknown): AuthCallbackFailure {
  const code = getAuthErrorCode(error)

  if (code === "flow_state_expired" || code === "otp_expired") {
    return "expired"
  }

  if (
    code === "flow_state_not_found" ||
    code === "invite_not_found" ||
    code === "refresh_token_already_used"
  ) {
    return "replayed"
  }

  if (
    code === "bad_code_verifier" ||
    code === "bad_oauth_callback" ||
    code === "bad_oauth_state" ||
    code === "validation_failed" ||
    code === "invalid_credentials"
  ) {
    return "malformed"
  }

  return "provider_failed"
}

export function isAuthCallbackFailure(
  value: string | string[] | null | undefined
): value is AuthCallbackFailure {
  const candidate = Array.isArray(value) ? value[0] : value
  return AUTH_CALLBACK_FAILURES.some((failure) => failure === candidate)
}

export function getAuthCallbackFailureMessage(
  value: string | string[] | null | undefined
) {
  const failure = Array.isArray(value) ? value[0] : value

  switch (failure) {
    case "missing":
      return "This sign-in link is incomplete. Request a new link."
    case "malformed":
      return "This sign-in link is invalid. Request a new link."
    case "expired":
      return "This sign-in link has expired. Request a new link."
    case "replayed":
      return "This sign-in link was already used. Request a new link."
    case "session_replacement_required":
      return "You're already signed in to another account. Confirm before switching accounts."
    case "provider_failed":
    default:
      return "We couldn't complete sign in. Try again."
  }
}

function isValidCredential(value: string) {
  return (
    value.length >= 8 &&
    value.length <= MAX_AUTH_CREDENTIAL_LENGTH &&
    !/\s/.test(value) &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    })
  )
}

function getAuthErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return null
  }

  return typeof error.code === "string" ? error.code : null
}
