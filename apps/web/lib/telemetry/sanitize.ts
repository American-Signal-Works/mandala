const REDACTED = "[redacted]"

const sensitiveKeyPattern =
  /(?:^|_)(?:access|refresh|id)?_?token(?:_|$)|token_hash|authorization|cookie|set-cookie|password|passwd|secret|api[_-]?key|request[_-]?body/i
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const bearerPattern = /\bBearer\s+[^\s,;]+/gi
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
const assignedSecretPattern =
  /\b(token|secret|password|authorization|cookie|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi
const absoluteUrlPattern = /https?:\/\/[^\s"'<>]+/gi
const relativeUrlPattern = /(?<![A-Za-z0-9])\/[A-Za-z0-9_./-]+[?#][^\s"'<>]+/g

type MutableTelemetryRecord = Record<string, unknown>

export function sanitizeTelemetryEvent<T>(event: T): T {
  if (!isRecord(event)) return event
  const sanitized = event as MutableTelemetryRecord

  if (isRecord(sanitized.user)) {
    sanitized.user =
      typeof sanitized.user.id === "string"
        ? { id: sanitized.user.id }
        : undefined
  }

  if (isRecord(sanitized.request)) {
    if (typeof sanitized.request.url === "string") {
      sanitized.request.url = stripUrlSecrets(sanitized.request.url)
    }
    delete sanitized.request.headers
    delete sanitized.request.cookies
    delete sanitized.request.data
    delete sanitized.request.body
  }

  sanitizeRecord(sanitized, new WeakSet<object>())
  return event
}

export function sanitizeTelemetrySpan<T>(span: T): T {
  return sanitizeTelemetryEvent(span)
}

export function sanitizeTelemetryText(value: string): string {
  return value
    .replace(absoluteUrlPattern, stripUrlSecrets)
    .replace(relativeUrlPattern, stripUrlSecrets)
    .replace(bearerPattern, `Bearer ${REDACTED}`)
    .replace(jwtPattern, REDACTED)
    .replace(assignedSecretPattern, (_match, label: string) => {
      return `${label}=${REDACTED}`
    })
    .replace(emailPattern, REDACTED)
}

export function stripUrlSecrets(value: string): string {
  const queryIndex = value.indexOf("?")
  const hashIndex = value.indexOf("#")
  const indexes = [queryIndex, hashIndex].filter((index) => index >= 0)
  if (indexes.length === 0) return value
  return value.slice(0, Math.min(...indexes))
}

function sanitizeRecord(
  record: MutableTelemetryRecord,
  visited: WeakSet<object>
) {
  if (visited.has(record)) return
  visited.add(record)

  for (const [key, value] of Object.entries(record)) {
    if (isSensitiveKey(key)) {
      delete record[key]
      continue
    }

    if (typeof value === "string") {
      record[key] = key.toLowerCase().includes("url")
        ? stripUrlSecrets(value)
        : sanitizeTelemetryText(value)
      continue
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const item = value[index]
        if (typeof item === "string") {
          value[index] = sanitizeTelemetryText(item)
        } else if (isRecord(item)) {
          sanitizeRecord(item, visited)
        }
      }
      continue
    }

    if (isRecord(value)) sanitizeRecord(value, visited)
  }
}

function isRecord(value: unknown): value is MutableTelemetryRecord {
  return typeof value === "object" && value !== null
}

function isSensitiveKey(key: string) {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase()
  return (
    sensitiveKeyPattern.test(key) ||
    normalized === "body" ||
    normalized === "requestbody" ||
    normalized === "requestdata" ||
    normalized === "formdata"
  )
}
