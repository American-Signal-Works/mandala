export type AuthCallbackMethod = "email" | "google" | "microsoft"
export type AuthCallbackPendingAction = "send" | "google" | "microsoft"

export function getCallbackPendingAction(
  value: string | string[] | null | undefined
): AuthCallbackPendingAction {
  const method = Array.isArray(value) ? value[0] : value

  if (method === "google" || method === "microsoft") {
    return method
  }

  return "send"
}
