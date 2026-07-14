import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { z } from "zod"

const cursorEnvelopeSchema = z
  .object({
    version: z.literal(1),
    binding: z.string().regex(/^[0-9a-f]{64}$/),
    page: z.unknown(),
    signature: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

const MAX_CURSOR_LENGTH = 4_096
const MIN_SECRET_LENGTH = 32
const processCursorSecret = randomBytes(32).toString("hex")

export class BoundCursorError extends Error {
  constructor() {
    super("invalid_cursor")
    this.name = "BoundCursorError"
  }
}

export function encodeBoundCursor(input: {
  binding: unknown
  page: unknown
  secret: string
}): string {
  assertSecret(input.secret)
  const binding = hashBinding(input.binding)
  const unsigned = { version: 1 as const, binding, page: input.page }
  const signature = sign(unsigned, input.secret)
  return Buffer.from(
    JSON.stringify({ ...unsigned, signature }),
    "utf8"
  ).toString("base64url")
}

export function decodeBoundCursor<T>(input: {
  cursor: string
  binding: unknown
  pageSchema: z.ZodType<T>
  secret: string
}): T {
  assertSecret(input.secret)
  if (
    input.cursor.length === 0 ||
    input.cursor.length > MAX_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(input.cursor)
  ) {
    throw new BoundCursorError()
  }

  try {
    const decoded = Buffer.from(input.cursor, "base64url").toString("utf8")
    const envelope = cursorEnvelopeSchema.parse(JSON.parse(decoded))
    const expectedBinding = hashBinding(input.binding)
    if (!safeEqual(envelope.binding, expectedBinding)) {
      throw new BoundCursorError()
    }

    const expectedSignature = sign(
      {
        version: envelope.version,
        binding: envelope.binding,
        page: envelope.page,
      },
      input.secret
    )
    if (!safeEqual(envelope.signature, expectedSignature)) {
      throw new BoundCursorError()
    }
    return input.pageSchema.parse(envelope.page)
  } catch (error) {
    if (error instanceof BoundCursorError) throw error
    throw new BoundCursorError()
  }
}

export function cursorBindingHash(binding: unknown): string {
  return hashBinding(binding)
}

export function resolveCursorSecret(
  environment: NodeJS.ProcessEnv = process.env
): string {
  const secret =
    environment.MANDALA_CONTROL_BINDING_SECRET?.trim() ||
    environment.MANDALA_CONTROL_INPUT_HASH_KEY?.trim()
  if (secret && secret.length < MIN_SECRET_LENGTH) {
    throw new Error("cursor_configuration_failed")
  }
  return secret ?? processCursorSecret
}

function assertSecret(secret: string): void {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error("cursor_configuration_failed")
  }
}

function hashBinding(binding: unknown): string {
  return createHmac("sha256", "mandala:cursor-binding:v1")
    .update(stableStringify(binding))
    .digest("hex")
}

function sign(
  value: { version: 1; binding: string; page: unknown },
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(stableStringify(value))
    .digest("hex")
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex")
  const rightBuffer = Buffer.from(right, "hex")
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}
