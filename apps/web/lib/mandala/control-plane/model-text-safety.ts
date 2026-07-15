const credentialOrPiiPatterns = [
  /\bbearer\s+[a-z0-9._~+/=-]{8,}/i,
  /\b(?:sk|rk|pk)-[a-z0-9_-]{8,}\b/i,
  /\bgh[pousr]_[a-z0-9_]{20,}\b/i,
  /\bgithub_pat_[a-z0-9_]{20,}\b/i,
  /\bxox[baprs]-[a-z0-9-]{10,}\b/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bAIza[a-z0-9_-]{20,}\b/i,
  /-----begin [a-z0-9 ]*private key-----/i,
  /\b(?:password|passcode|secret|token|credential|api[_ -]?key|authorization|cookie|session)\s*[:=]\s*\S+/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
] as const

const promptOrReasoningPatterns = [
  /\b(?:system|developer) prompt\b/i,
  /\bchain[- ]of[- ]thought\b/i,
  /\bhidden reasoning\b/i,
] as const

export type ModelTextSafetyViolation =
  | "credential_or_pii"
  | "prompt_or_hidden_reasoning"

export function modelTextSafetyViolation(
  value: string
): ModelTextSafetyViolation | null {
  if (credentialOrPiiTextViolation(value)) return "credential_or_pii"
  if (promptOrReasoningTextViolation(value)) return "prompt_or_hidden_reasoning"
  return null
}

export function credentialOrPiiTextViolation(value: string): boolean {
  const screened = screenKnownIdentifiers(value)
  return credentialOrPiiPatterns.some((pattern) => pattern.test(screened))
}

export function promptOrReasoningTextViolation(value: string): boolean {
  const screened = screenKnownIdentifiers(value)
  return promptOrReasoningPatterns.some((pattern) => pattern.test(screened))
}

function screenKnownIdentifiers(value: string): string {
  return value.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    "[uuid]"
  )
}
