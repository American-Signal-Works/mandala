import type { Writable } from "node:stream"
import { asCliError } from "./errors.js"

const sensitiveKey =
  /^(?:access_?token|refresh_?token|raw_?token|token_?hash|authorization|code_?verifier)$/i

export type OutputOptions = {
  json: boolean
  stdout: Writable
  stderr: Writable
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redactSecrets(entry),
      ])
    )
  }
  if (typeof value === "string") return redactText(value)
  return value
}

export function writeSuccess(options: OutputOptions, data: unknown): void {
  const envelope = { ok: true as const, data: redactSecrets(data) }
  options.stdout.write(
    `${JSON.stringify(options.json ? envelope : envelope.data, null, options.json ? undefined : 2)}\n`
  )
}

export function writeFailure(options: OutputOptions, error: unknown): number {
  const safe = asCliError(error)
  const envelope = {
    ok: false as const,
    error: {
      code: safe.code,
      message: redactText(safe.message),
    },
  }
  options.stderr.write(
    `${JSON.stringify(options.json ? envelope : envelope.error, null, options.json ? undefined : 2)}\n`
  )
  return safe.exitCode
}

function redactText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[REDACTED]"
    )
}
