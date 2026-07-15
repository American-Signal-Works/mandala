const RECENT_AUTH_WINDOW_MS = 15 * 60 * 1000

type SessionAuthClaims = {
  amr?: unknown
  session_id?: unknown
  sub?: unknown
}

export function isRecentSessionAuthentication(
  claims: SessionAuthClaims | null | undefined,
  expectedUserId: string,
  now = Date.now()
) {
  if (
    !claims ||
    claims.sub !== expectedUserId ||
    typeof claims.session_id !== "string" ||
    claims.session_id.length === 0 ||
    !Array.isArray(claims.amr)
  ) {
    return false
  }

  const latestAuthentication = claims.amr.reduce<number | null>(
    (latest, reference) => {
      if (
        typeof reference !== "object" ||
        reference === null ||
        !("method" in reference) ||
        !("timestamp" in reference) ||
        typeof reference.method !== "string" ||
        reference.method.length === 0 ||
        typeof reference.timestamp !== "number" ||
        !Number.isFinite(reference.timestamp)
      ) {
        return latest
      }
      const timestamp = reference.timestamp * 1_000
      return latest === null || timestamp > latest ? timestamp : latest
    },
    null
  )

  return (
    latestAuthentication !== null &&
    latestAuthentication <= now &&
    now - latestAuthentication <= RECENT_AUTH_WINDOW_MS
  )
}
