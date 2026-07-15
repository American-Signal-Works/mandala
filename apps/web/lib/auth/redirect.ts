import type { AuthCallbackMethod } from "@/lib/auth/callback"

export const AUTH_SUCCESS_PATH = "/login?auth=success"
export const INVITATION_COMPLETE_PATH = "/invitation/complete"
export const AUTH_CONTINUATION_COOKIE = "mandala-auth-continuation"
export const AUTH_CONTINUATION_COOKIE_PATH = "/callback"
export const AUTH_CONTINUATION_MAX_AGE_SECONDS = 10 * 60

const SAFE_POST_AUTH_PATHS = new Set([
  AUTH_SUCCESS_PATH,
  INVITATION_COMPLETE_PATH,
])

export function getAuthCallbackUrl(
  nextPath = AUTH_SUCCESS_PATH,
  method?: AuthCallbackMethod
) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const origin =
    configuredSiteUrl ||
    (typeof window === "undefined" ? "" : window.location.origin)

  const callbackUrl = new URL("/callback", origin.replace(/\/+$/, ""))
  callbackUrl.searchParams.set("next", getSafePostAuthPath(nextPath))
  if (method) {
    callbackUrl.searchParams.set("method", method)
  }

  return callbackUrl.toString()
}

export function getEmailRedirectTo(nextPath = AUTH_SUCCESS_PATH) {
  void nextPath
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const origin =
    configuredSiteUrl ||
    (typeof window === "undefined" ? "" : window.location.origin)
  return new URL("/callback", origin.replace(/\/+$/, "")).toString()
}

export function getSafePostAuthPath(value: string | null | undefined) {
  if (!value) {
    return AUTH_SUCCESS_PATH
  }

  try {
    const parsed = new URL(value, "https://mandala.local")
    const isInternalPath = parsed.origin === "https://mandala.local"
    const normalizedPath = `${parsed.pathname}${parsed.search}`

    if (isInternalPath && SAFE_POST_AUTH_PATHS.has(normalizedPath)) {
      return normalizedPath
    }
  } catch {
    return AUTH_SUCCESS_PATH
  }

  return AUTH_SUCCESS_PATH
}
