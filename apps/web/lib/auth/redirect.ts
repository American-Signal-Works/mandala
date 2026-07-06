export const AUTH_SUCCESS_PATH = "/login?auth=success"

const SAFE_POST_AUTH_PATHS = new Set([AUTH_SUCCESS_PATH])

export function getAuthCallbackUrl(nextPath = AUTH_SUCCESS_PATH) {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const origin =
    configuredSiteUrl ||
    (typeof window === "undefined" ? "" : window.location.origin)

  const callbackUrl = new URL("/callback", origin.replace(/\/+$/, ""))
  callbackUrl.searchParams.set("next", getSafePostAuthPath(nextPath))

  return callbackUrl.toString()
}

export function getEmailRedirectTo() {
  return getAuthCallbackUrl(AUTH_SUCCESS_PATH)
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
