import { createClient } from "@/lib/supabase/browser"
import { getEmailRedirectTo } from "@/lib/auth/redirect"

export async function requestEmailMagicLink(email: string) {
  return withAuthFailure(
    () =>
      createClient().auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getEmailRedirectTo(),
        },
      }),
    (error) => ({ data: null, error })
  )
}

export async function signOutCurrentSession() {
  return withAuthFailure(
    () => createClient().auth.signOut(),
    (error) => ({ error })
  )
}

async function withAuthFailure<T, F>(
  request: () => Promise<T>,
  fallback: (error: Error) => F
) {
  try {
    return await request()
  } catch (error) {
    return fallback(toAuthClientError(error))
  }
}

function toAuthClientError(error: unknown) {
  if (error instanceof Error) {
    return error
  }

  return new Error("Authentication request failed.")
}
