import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import { createClient } from "@/lib/supabase/browser"
import { getAuthCallbackUrl, getEmailRedirectTo } from "@/lib/auth/redirect"
import type { AuthCallbackMethod } from "@/lib/auth/callback"
import type { Database } from "@/lib/supabase/types"

export type OAuthProvider = "google" | "azure"

type EmailMagicLinkOptions = {
  shouldCreateUser?: boolean
}

export async function requestEmailMagicLink(
  email: string,
  options: EmailMagicLinkOptions = {}
) {
  return withAuthFailure(
    () =>
      createMagicLinkClient().auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getEmailRedirectTo(),
          shouldCreateUser: options.shouldCreateUser,
        },
      }),
    (error) => ({ data: null, error })
  )
}

function createMagicLinkClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: "implicit",
        persistSession: false,
      },
    }
  )
}

export async function requestOAuthSignIn(provider: OAuthProvider) {
  return withAuthFailure(
    () =>
      createClient().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: getAuthCallbackUrl(
            undefined,
            getOAuthCallbackMethod(provider)
          ),
          ...(provider === "azure" ? { scopes: "email" } : {}),
        },
      }),
    (error) => ({ data: null, error })
  )
}

function getOAuthCallbackMethod(provider: OAuthProvider): AuthCallbackMethod {
  return provider === "azure" ? "microsoft" : "google"
}

export async function signOutCurrentSession() {
  return withAuthFailure(
    () => createClient().auth.signOut(),
    (error) => ({ error })
  )
}

export async function confirmCurrentSession() {
  return withAuthFailure(
    () => createClient().auth.getUser(),
    (error) => ({ data: { user: null }, error })
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
