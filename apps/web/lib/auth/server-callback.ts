import type { User } from "@supabase/supabase-js"

import {
  classifyAuthCallbackError,
  type AuthCallbackCredential,
  type AuthCallbackFailure,
} from "@/lib/auth/callback"

type AuthCallbackClient = {
  auth: {
    exchangeCodeForSession(code: string): Promise<{ error: unknown }>
    getUser(): Promise<{ data: { user: User | null }; error: unknown }>
    verifyOtp(input: {
      token_hash: string
      type: "email" | "signup"
    }): Promise<{ error: unknown }>
  }
}

export type AuthCallbackCompletion =
  | { ok: true; user: User }
  | { ok: false; failure: AuthCallbackFailure }

export async function completeAuthCallback(
  client: AuthCallbackClient,
  credential: AuthCallbackCredential
): Promise<AuthCallbackCompletion> {
  const exchange =
    credential.kind === "code"
      ? await client.auth.exchangeCodeForSession(credential.value)
      : await client.auth.verifyOtp({
          token_hash: credential.value,
          type: credential.type,
        })

  if (exchange.error) {
    return {
      ok: false,
      failure: classifyAuthCallbackError(exchange.error),
    }
  }

  const { data, error } = await client.auth.getUser()
  if (error || !data.user) {
    return { ok: false, failure: "provider_failed" }
  }

  return { ok: true, user: data.user }
}

export function hasAuthenticatedUser(result: { data: { user: User | null } }) {
  return Boolean(result.data.user)
}
