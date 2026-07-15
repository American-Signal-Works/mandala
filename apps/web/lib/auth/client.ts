import { createClient } from "@/lib/supabase/browser"
import { getAuthCallbackUrl } from "@/lib/auth/redirect"
import type { AuthCallbackMethod } from "@/lib/auth/callback"

export type OAuthProvider = "google" | "azure"

type EmailMagicLinkOptions = {
  postAuthPath?: string
  shouldCreateUser?: boolean
}

export async function requestEmailMagicLink(
  email: string,
  options: EmailMagicLinkOptions = {}
) {
  const result = await withAuthFailure(
    async () => {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          postAuthPath: options.postAuthPath,
          shouldCreateUser: options.shouldCreateUser,
        }),
      })

      if (!response.ok) {
        throw new Error("Authentication email request failed.")
      }

      return { data: { accepted: true as const }, error: null }
    },
    (error) => ({ data: null, error })
  )

  if (result.error) {
    return {
      data: null,
      error: new Error("Authentication email request failed."),
    }
  }

  return result
}

export async function requestOAuthSignIn(
  provider: OAuthProvider,
  postAuthPath?: string
) {
  return withAuthFailure(
    () =>
      createClient().auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: getAuthCallbackUrl(
            postAuthPath,
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
