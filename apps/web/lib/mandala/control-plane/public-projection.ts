const blockedKeyFragments = [
  "authorization",
  "bearer",
  "chainofthought",
  "credential",
  "hiddenreasoning",
  "memoryref",
  "password",
  "prompt",
  "rawtrace",
  "secret",
  "token",
  "trace",
  "tracepayload",
] as const

const sensitiveTextPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(?:service[_ -]?role|access|refresh|api)[_ -]?token\s*[:=]\s*\S+/gi,
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\b(?:password|secret|webhook[_ -]?secret)\s*[:=]\s*\S+/gi,
] as const

export function sanitizePublicProjection<T>(value: T): T {
  return sanitize(value) as T
}

export function sanitizeLegacyItemDetail<T>(value: T): T {
  const original: Record<string, unknown> = isRecord(value) ? value : {}
  const sanitized = sanitizePublicProjection(value) as Record<string, unknown>

  if (isRecord(original.contextPacket) && isRecord(sanitized.contextPacket)) {
    sanitized.contextPacket = {
      ...sanitized.contextPacket,
      memoryRefs: [],
    }
  }
  if (Array.isArray(original.auditEvents)) {
    sanitized.auditEvents = original.auditEvents.map((event) => {
      const sanitizedEvent = sanitizePublicProjection(event)
      return {
        ...(isRecord(sanitizedEvent) ? sanitizedEvent : {}),
        trace: {},
      }
    })
  }
  return sanitized as T
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isBlockedKey(key))
        .map(([key, nested]) => [key, sanitize(nested)])
    )
  }
  if (typeof value === "string") {
    return sensitiveTextPatterns.reduce(
      (safe, pattern) => safe.replace(pattern, "[redacted]"),
      value
    )
  }
  return value
}

function isBlockedKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (normalized === "tokenestimate") return false
  return blockedKeyFragments.some((fragment) => normalized.includes(fragment))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
