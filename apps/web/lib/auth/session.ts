import { normalizeEmail } from "@/lib/auth/validation"

export type SessionIdentity = {
  id: string
  email?: string | null
}

export type SessionBindingResult =
  | { status: "session_absent" }
  | { status: "session_confirmed"; userId: string }
  | { status: "session_replacement_required"; currentUserId: string }

/**
 * Shared contract for invitation acceptance and other identity-bound handoffs.
 * It never mutates or replaces the current session.
 */
export function evaluateSessionBinding(
  currentUser: SessionIdentity | null,
  expectedEmail: string
): SessionBindingResult {
  if (!currentUser) {
    return { status: "session_absent" }
  }

  const currentEmail = currentUser.email
    ? normalizeEmail(currentUser.email)
    : null
  const normalizedExpectedEmail = normalizeEmail(expectedEmail)

  if (currentEmail && currentEmail === normalizedExpectedEmail) {
    return { status: "session_confirmed", userId: currentUser.id }
  }

  return {
    status: "session_replacement_required",
    currentUserId: currentUser.id,
  }
}
