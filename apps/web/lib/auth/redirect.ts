export function getEmailRedirectTo() {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  const origin =
    configuredSiteUrl ||
    (typeof window === "undefined" ? "" : window.location.origin)

  return `${origin.replace(/\/+$/, "")}/callback`
}
